const walk = require("./walk.cjs");
const word = require("./word.jsx");
const { signal } = new AbortController();
const event = new Event("ping");
const found = walk(signal) > 0;
word.send(signal, event);
console.log(found, typeof event.target.process.finalization);
