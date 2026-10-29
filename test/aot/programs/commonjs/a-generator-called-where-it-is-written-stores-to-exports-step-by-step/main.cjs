// A generator called where it is written stores to exports step by step.
const m = require("./m.cjs");
console.log(m.a, m.b, m.c, Object.keys(m).join());
m.it.next();
console.log(m.a, m.b, m.c, Object.keys(m).join());
