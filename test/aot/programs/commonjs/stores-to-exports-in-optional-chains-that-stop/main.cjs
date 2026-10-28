// Stores to exports in optional chains that stop.
const m = require("./m.cjs");
console.log(Object.keys(m).join(), m.a, m.b, m.c, m.d, m.e, m.f);
