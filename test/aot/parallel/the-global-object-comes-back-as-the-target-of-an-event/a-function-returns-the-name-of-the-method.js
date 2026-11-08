const { signal } = new AbortController();
const event = new Event("ping");
function name() { return "dispatchEvent"; }
const send = signal[name()];
send(event);
console.log(typeof event.target.process.finalization);
