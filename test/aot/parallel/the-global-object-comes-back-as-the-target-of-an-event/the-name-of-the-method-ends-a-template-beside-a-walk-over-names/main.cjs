const walk = require("./walk.cjs");
const word = require("./word.cjs");
const { signal } = new AbortController();
const event = new Event("ping");
const found = walk(signal) > 0;
word(signal, event, String(found).slice(4));
console.log(found, typeof event.target.process.finalization);
