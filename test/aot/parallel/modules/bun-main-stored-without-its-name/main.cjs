// Alone: which file is the main module goes by the entry points of the executable
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
const other = require("./other.cjs");
const atFirst = Bun.main;
const ways = {
  "a computed key": path => void (Bun["ma" + "in"] = path),
  "one of two keys": path => void (Bun[process.argv.length > 50 ? "x" : "main"] = path),
  "another name for Bun": path => void (globalThis.Bun.main = path),
  "require('bun')": path => void (require("bun").main = path),
  "Reflect.set": path => void Reflect.set(Bun, "main", path),
  "Object.assign": path => void Object.assign(Bun, { main: path }),
  "a function of another file": path => other.store(path),
  "Bun taken out of a list": path => void (other.identity(Bun).main = path),
};
for (const [way, store] of Object.entries(ways)) {
  store(other.me.filename);
  console.log(way, nameOf(require.main), require.main === other.me, require.main === module, require.main.exports.call());
  Bun.main = atFirst;
}
