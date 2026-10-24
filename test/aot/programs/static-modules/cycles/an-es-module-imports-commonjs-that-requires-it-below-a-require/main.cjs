// e.mjs imports k.cjs, k.cjs requires e.mjs, and a require() of e.mjs starts it. k.cjs runs before e.mjs and gets the placeholder of that require(): an object without keys, for ever.
const e = require("./e.mjs");
console.log(e.seen, e.later(), e.value);
