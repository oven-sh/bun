import names from "./names.json";
const { signal } = new AbortController();
const event = new Event("ping");
const send = signal[names.send];
send(event);
console.log(typeof event.target.process.finalization);
