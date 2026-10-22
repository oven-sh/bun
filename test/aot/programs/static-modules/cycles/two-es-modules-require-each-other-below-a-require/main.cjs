// first.mjs requires second.mjs, which requires first.mjs back, and a require() started it all: second.mjs gets the placeholder of first.mjs, an object without keys, and keeps it.
const first = require("./first.mjs");
console.log(first.fromSecond, require("./second.mjs").later());
