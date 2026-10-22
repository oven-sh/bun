// The same two modules, but a.mjs is loaded by a require(): k.cjs gets the placeholder, an object without keys, and keeps it.
const a = require("./a.mjs");
console.log(a.seen, a.readLater());
