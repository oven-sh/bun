globalThis.mails = (globalThis.mails ?? 0) + 1;
const mail = globalThis.mails;
exports.mail = () => "mail " + mail;
