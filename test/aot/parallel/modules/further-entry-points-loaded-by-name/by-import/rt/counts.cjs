globalThis.ran = (globalThis.ran ?? 0) + 1;
module.exports = { ran: globalThis.ran };
