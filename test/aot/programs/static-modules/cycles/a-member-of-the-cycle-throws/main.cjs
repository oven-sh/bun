// The second module of a cycle throws behind its look at the first, and the first catches that and goes on.
const a = require("./a.cjs");
console.log(a.caught, globalThis.seenByB, a.late);
