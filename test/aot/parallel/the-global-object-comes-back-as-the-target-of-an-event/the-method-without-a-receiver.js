// Without a receiver the target is the global object.
const event = new Event("ping");
const send = EventTarget.prototype.dispatchEvent;
send(event);
console.log(typeof event.target.process.finalization);
