// Another file wraps every exported function in a loop.
const m = require("./m.cjs");
for (const k of Object.keys(m)) { const original = m[k]; if (typeof original === "function") m[k] = (...x) => "wrapped(" + original(...x) + ")"; }
console.log(m.f(), m.g(), m.viaExports(), require("./other.cjs").f());
