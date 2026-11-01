// Alone: which file is the main module goes by the entry points of the executable
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
Bun.main = require.resolve("./module.mjs");
console.log("before", nameOf(require.main));
const module_ = require("./module.mjs");
console.log(nameOf(require.main), require.main.exports === module_, require.main.exports.mark, require.main.exports.call(3));
const data = require("./data.json");
Bun.main = require.resolve("./data.json");
console.log(nameOf(require.main), require.main.exports === data, require.main.exports.mark);
