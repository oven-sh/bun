const event = new Event("ping");
const send = AbortSignal.prototype.dispatchEvent;
send(event);
console.log(typeof event.target.process.finalization);
