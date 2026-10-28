// A function called where it is written returns ahead of a store to exports.
const m = require("./m.cjs");
console.log(m.a, m.b, m.c, Object.keys(m).join());
