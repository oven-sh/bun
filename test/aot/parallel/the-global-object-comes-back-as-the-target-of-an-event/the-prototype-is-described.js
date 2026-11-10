const event = new Event("ping");
const send = Object.getOwnPropertyDescriptor(EventTarget.prototype, JSON.parse('"dispatchEvent"')).value;
send(event);
console.log(typeof event.target.process.finalization);
