// The import() in module.mjs runs file.cjs before the require() here returns, and file.cjs requires module.mjs too.
console.log("main begins");
const first = require("./module.mjs");
console.log("main has", Object.keys(first).join(), first.second);
setTimeout(() => globalThis.later(), 1);
