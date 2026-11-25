// The value of a comma is the function alone: the call has no receiver.
const { signal } = new AbortController();
const event = new Event("ping");
(0, signal.dispatchEvent)(event);
console.log(typeof event.target.process.finalization);
