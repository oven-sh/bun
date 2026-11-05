// Alone: which file is the main module goes by the entry points of the executable
const nameOf = m => (m && m.filename ? m.filename.split(/[\\/]/).at(-1) : String(m));
const other = require("./other.cjs");
const third = require("./third.cjs");
exports.call = () => "called in main";

console.log("at first", nameOf(require.main), require.main === module, other.isMain(), nameOf(other.main()));
const atFirst = Bun.main;
for (const file of [other.me, third.me, module, other.me]) {
  Bun.main = file.filename;
  console.log(
    nameOf(file),
    nameOf(require.main),
    require.main === file,
    require.main === module,
    other.isMain(),
    nameOf(other.main()),
    require.main.exports.call(),
    nameOf(require("node:module").createRequire(__filename).main),
  );
}
console.log("process.mainModule", nameOf(process.mainModule));
Bun.main = atFirst;
console.log("back", nameOf(require.main), require.main === module, other.isMain());
for (const path of ["/no/such/file.cjs", "", 1, null, undefined, {}, "node:fs"]) {
  Bun.main = path;
  console.log(String(path), nameOf(require.main), require.main === module, other.isMain());
}
