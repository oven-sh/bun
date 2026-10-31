// Alone: which file is the main module goes by the entry points of the executable
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
Bun.main = require.resolve("./late.cjs");
console.log("before", nameOf(require.main), require.main === module);
const late = require("./late.cjs");
console.log("after", nameOf(require.main), require.main === late.me, require.main === module, late.atLoad.join());
Bun.main = require.resolve("./late.mjs");
console.log("an ES module", require("./late.mjs").atLoad);
