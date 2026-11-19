// No listener: the event keeps its target behind the call.
const event = new Event("ping");
dispatchEvent(event);
console.log(typeof event.target.process.finalization);
