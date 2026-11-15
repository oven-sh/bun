import { NAME } from "./names.mjs";
const { signal } = new AbortController();
const event = new Event("ping");
const send = signal[NAME];
send(event);
console.log(typeof event.target.process.finalization);
