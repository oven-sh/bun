const word = require("./word.cjs");
const { signal } = new AbortController();
const event = new Event("ping");
word(signal, event, String(signal.aborted).slice(5));
console.log(typeof event.target.process.finalization);
