// The receiver of a call through a holder, of the same function taken off first, and of an arrow.
const a = require("./a.cjs");
console.log(a.self() === a, (0, a.self)() === undefined, a.arrow());
