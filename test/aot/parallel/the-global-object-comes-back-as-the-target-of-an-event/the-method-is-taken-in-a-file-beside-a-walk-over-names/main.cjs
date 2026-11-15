// The file that walks over names asks for all that unseen code finds: the texts of the files behind it are asked no more.
const walk = require("./walk.cjs");
const word = require("./word.cjs");
const { signal } = new AbortController();
const event = new Event("ping");
const found = walk(signal) > 0;
word(signal, event);
console.log(found, typeof event.target.process.finalization);
