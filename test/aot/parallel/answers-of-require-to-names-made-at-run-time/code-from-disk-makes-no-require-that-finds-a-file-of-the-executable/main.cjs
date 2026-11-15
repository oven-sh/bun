// Where code may come from disk, that code finds no file of the executable. Who asks goes by what made the require(), not by the path that it was made for:
// the program makes one for its folder locales, in which no file of code lies, and finds en.json. It was refused.
// A file from disk that makes one for the same folder is refused, and so is one that asks through its `module.parent`, where the program has loaded it by a require() that it made,
// through an object that is no module object, or through a require() that it had the program make without the program calling createRequire() itself.
// The expected output is written down: under `bun run` all of them find the file.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const made = word => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
const folder = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "made-up-code-from-disk-"));
fs.writeFileSync(
  path.join(folder, "from-disk.cjs"),
  `const Module = require("node:module");
exports.makesOne = folder => Module.createRequire(folder)("./en");
exports.asksThroughParent = id => Module.prototype.require.call(module.parent, id);
exports.asksThroughAnObject = (id, filename) => Module.prototype.require.call({ filename }, id);
const kept = {};
exports.hasOneMade = path => Object.assign.bind(null, kept, Object.defineProperty({}, "made", { enumerable: true, get: Module.createRequire.bind(null, path) }));
exports.asksThroughWhatWasMade = id => kept.made(id);`,
);
const fromDisk = createRequire(folder + "/")("./" + made("from-disk.cjs"));
fs.rmSync(folder, { recursive: true });
const locales = path.dirname(module.filename) + "/locales/";
fromDisk.hasOneMade(module.filename)();
for (const find of [
  () => createRequire(__dirname + "/locales/")("./" + made("en")),
  () => fromDisk.makesOne(locales),
  () => fromDisk.asksThroughParent(locales + "en"),
  () => fromDisk.asksThroughAnObject(locales + "en", module.filename),
  () => fromDisk.asksThroughAnObject(locales + "en", ""),
  () => fromDisk.asksThroughWhatWasMade(locales + "en"),
]) {
  try {
    console.log(find().said);
  } catch (error) {
    console.log("threw", error.code);
  }
}
/* Output:
locales/en.json
threw MODULE_NOT_FOUND
threw MODULE_NOT_FOUND
threw MODULE_NOT_FOUND
threw MODULE_NOT_FOUND
threw MODULE_NOT_FOUND
*/
