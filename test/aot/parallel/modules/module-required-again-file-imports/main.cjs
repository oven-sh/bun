// The import() in module.mjs runs file.cjs when the require() here has returned, and file.cjs requires module.mjs too. `bun run` runs it before the require() returns.
// Reference: bun build --compile
console.log("main begins");
const first = require("./module.mjs");
console.log("main has", Object.keys(first).join(), first.second);
setTimeout(() => globalThis.later(), 1);
