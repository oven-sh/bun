// a.mjs calls import() of b.cjs while this require() loads it. The call is no part of the graph that the require() loads: b.cjs runs when the require() has returned, and its own require() of a.mjs finds what a.mjs exports.
// `bun run` takes the steps of the call inside the require(): b.cjs runs before a.mjs is done, and reads undefined.
// Reference: bun build --compile
const a = require("./a.mjs");
console.log("main has " + a.fromA);
globalThis.inner.then(b => console.log("the call has " + b.fromB));
