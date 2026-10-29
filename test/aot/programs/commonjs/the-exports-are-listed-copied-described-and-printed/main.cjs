// The exports are listed copied described and printed.
const m = require("./m.cjs");
console.log(JSON.stringify(m), Object.keys(m).join(), Object.entries({ ...m }).length, Object.getOwnPropertyNames(m).join(), m.hasOwnProperty("b"), "toString" in m, String(m), m.constructor === Object, Object.getPrototypeOf(m) === Object.prototype);
for (const k in m) console.log(k, JSON.stringify(Object.getOwnPropertyDescriptor(m, k)));
