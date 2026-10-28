// Members of exports as targets of patterns and loops.
const m = require("./m.cjs");
console.log(Object.keys(m).join(), m.a, m.b, m.c, m.d);
