// A store that runs before `module.exports = { .. }` lands on the first object.
const m = require("./module.cjs");
console.log(Object.keys(m).join(), m.a, m.early, m.late);
const below = require("./below.cjs");
console.log(below.a, below.b, below.c, below.read());
