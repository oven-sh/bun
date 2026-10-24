// k.cjs requires e.mjs in the middle of its body, and e.mjs imports a name that k stores only afterwards: the link of e.mjs fails with a SyntaxError, which the require() in k throws. Nothing of e.mjs runs.
const k = require("./k.cjs");
console.log(k.outcome, k.late);
