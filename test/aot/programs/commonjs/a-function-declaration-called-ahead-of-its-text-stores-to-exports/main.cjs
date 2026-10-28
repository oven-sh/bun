// A function declaration called ahead of its text stores to exports.
const m = require("./m.cjs");
console.log(Object.keys(m).join(), m.a, m.b);
