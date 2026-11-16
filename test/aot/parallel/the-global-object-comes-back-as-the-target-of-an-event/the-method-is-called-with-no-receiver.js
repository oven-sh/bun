const event = new Event("ping");
EventTarget.prototype.dispatchEvent.call(undefined, event);
console.log(typeof event.target.process.finalization);
