// `require` under another name, `module.require`, `require.call` and `require?.()`.
const r = require;
console.log(r("./a.cjs").n, module.require("./a.cjs").n, require.call(null, "./a.cjs").n, require?.("./a.cjs").n);
