const event = new Event("ping");
const send = EventTarget.prototype.dispatchEvent.bind(null);
send(event);
console.log(typeof event.target.process.finalization);
