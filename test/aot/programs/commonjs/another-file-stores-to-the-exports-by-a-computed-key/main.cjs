// Another file stores to the exports by a computed key.
const m = require("./m.cjs");
const k = ["a", "f"][Date.now() > 0 ? 0 : 1];
m[k] = "stored by key";
console.log(m.a, m[k], m.readA(), m["f"](), m[`${"read"}A`]());
