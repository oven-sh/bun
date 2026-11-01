// Alone: which file is the main module goes by the entry points of the executable
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
const other = require("./other.cjs");
const atFirst = Bun.main;
Object.assign(Bun, { main: other.me.filename });
console.log(nameOf(require.main), require.main === other.me, require.main === module, other.isMain(), require.main.exports.call());
Object.assign(Bun, { main: atFirst });
console.log(nameOf(require.main), require.main === module, other.isMain());
