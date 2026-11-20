const { signal } = new AbortController();
const event = new Event("ping");
let name = "dispatchEvent";
const send = signal[name];
send(event);
console.log(typeof event.target.process.finalization);
