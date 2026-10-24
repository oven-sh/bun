// Exports stored behind a return that is not taken.
const m = require("./m.cjs");
console.log(m.a, m.b, typeof m.f, "b" in m, Object.keys(m).join());
