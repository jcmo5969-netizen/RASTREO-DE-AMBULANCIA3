// api/notify.js  (Serverless Function para proyecto estático en Vercel)
module.exports = async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Parsear body (en funciones Node puras req.body viene vacío)
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = (raw && raw.length) ? JSON.parse(raw) : {};

    const text = body.message || 'AmbuTrack – mensaje';
    const doctorPhoneRaw = String(body.doctor_phone || '');
    const phone = normalizeE164(doctorPhoneRaw); // +569XXXXXXX

    if (!phone) return res.status(400).json({ ok:false, error:'doctor_phone inválido o vacío' });

    const sent = await sendMessage({ text, phone });
    if (!sent.ok) return res.status(500).json(sent);

    return res.status(200).json({ ok:true, via: sent.via });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e?.message || 'server_error' });
  }
};

function normalizeE164(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g,'');
  if (d.startsWith('56')) return `+${d}`;
  if (d.length === 9 && d.startsWith('9')) return `+56${d}`;
  if (d.length === 8) return `+569${d}`;
  if (/^\d{10,15}$/.test(d)) return `+${d}`;
  return null;
}

async function sendMessage({ text, phone }) {
  // 1) WhatsApp Cloud API (Meta)
  const META_TOKEN = process.env.META_WABA_TOKEN;
  const META_PHONE_ID = process.env.META_WABA_PHONE_ID; // p.ej. '123456789012345'
  if (META_TOKEN && META_PHONE_ID) {
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${META_PHONE_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace('+',''),
          type: 'text',
          text: { body: text, preview_url: false }
        })
      });
      const j = await safeJson(r);
      if (!r.ok) return { ok:false, via:'whatsapp_cloud', error: j?.error || j || 'meta_failed' };
      return { ok:true, via:'whatsapp_cloud', id: j?.messages?.[0]?.id };
    } catch {}
  }

  // 2) Twilio WhatsApp (fallback)
  const TW_SID = process.env.TWILIO_ACCOUNT_SID;
  const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TW_WA_FROM = process.env.TWILIO_WHATSAPP_FROM; // 'whatsapp:+14155238886'
  if (TW_SID && TW_TOKEN && TW_WA_FROM) {
    try {
      const auth = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64');
      const params = new URLSearchParams({ From: TW_WA_FROM, To: `whatsapp:${phone}`, Body: text });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
        method:'POST', headers:{ 'Authorization':`Basic ${auth}`, 'Content-Type':'application/x-www-form-urlencoded' }, body: params
      });
      const j = await safeJson(r);
      if (!r.ok) return { ok:false, via:'twilio_whatsapp', error: j || 'twilio_wa_failed' };
      return { ok:true, via:'twilio_whatsapp', sid: j?.sid };
    } catch {}
  }

  // 3) Twilio SMS (último fallback)
  const TW_SMS_FROM = process.env.TWILIO_SMS_FROM; // '+1XXXXXXXXXX'
  if (TW_SID && TW_TOKEN && TW_SMS_FROM) {
    try {
      const auth = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64');
      const params = new URLSearchParams({ From: TW_SMS_FROM, To: phone, Body: text });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
        method:'POST', headers:{ 'Authorization':`Basic ${auth}`, 'Content-Type':'application/x-www-form-urlencoded' }, body: params
      });
      const j = await safeJson(r);
      if (!r.ok) return { ok:false, via:'twilio_sms', error: j || 'twilio_sms_failed' };
      return { ok:true, via:'twilio_sms', sid: j?.sid };
    } catch (e) {
      return { ok:false, via:'twilio_sms', error: e?.message || 'twilio_sms_error' };
    }
  }

  return { ok:false, via:'none', error:'No hay credenciales configuradas' };
}

async function safeJson(r) { try { return await r.json(); } catch { return await r.text(); } }
