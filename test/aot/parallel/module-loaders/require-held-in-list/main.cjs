// `require` reaches its call through an element of a list. The file runs there, ahead of the `require` that names it, and runs once.
const load = [require][0];
const early = load("./counter.cjs");
console.log(early.count, globalThis.runs);
const late = require("./counter.cjs");
console.log(late === early, late.count, globalThis.runs);
early.count = 5;
console.log(late.count, late.read());
