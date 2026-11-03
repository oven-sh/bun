// Alone: which file is the main module goes by the entry points of the executable
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
const other = require("./other.cjs");
const atFirst = Bun.main;
console.log(Reflect.set(Bun, "main", other.me.filename));
console.log(nameOf(require.main), require.main === other.me, require.main === module, other.isMain(), require.main.exports.call());
console.log(Reflect.set(Bun, "main", atFirst));
console.log(nameOf(require.main), require.main === module, other.isMain());
