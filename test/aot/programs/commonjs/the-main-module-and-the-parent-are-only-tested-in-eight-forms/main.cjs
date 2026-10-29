// The main module and the parent are only tested in eight forms.
console.log(require.main === module, !!require.main, typeof require.main, require.main == null, process.mainModule === module);
const a = require("./a.cjs");
console.log(a.r.join());
