// A file that only require.resolve() names is loaded by its path, if at all, so it is compiled as a file that a require() loads: a return at its top is no mistake.
const path = require("node:path");
console.log(path.basename(require.resolve("./returns.cjs")));
