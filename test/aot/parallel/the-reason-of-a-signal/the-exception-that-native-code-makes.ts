const controller = new AbortController();
controller.abort();
const reason = controller.signal.reason;
console.log(reason.name, reason.message, String(reason instanceof DOMException), reason.code);
