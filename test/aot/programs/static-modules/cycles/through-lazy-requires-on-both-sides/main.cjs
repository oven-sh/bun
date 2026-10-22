// Both requires of a cycle stand in functions, and both bodies call them.
const a = require("./a.cjs");
console.log(a.fromB, a.getB().fromA, a.getB().value);
