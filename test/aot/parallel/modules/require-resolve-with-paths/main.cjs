// require.resolve(name, { paths }) looks from each of the given folders in its turn, and never from the folder of the file that asks: first on disk, then among what the executable holds.
// The name is bare, relative or a whole path. The folders are absent, none, the importer's, another, the working directory or several, on disk (__dirname) or in the executable (module.path).
// What is named is in the executable, on disk, in both or in neither.
const path = require("node:path");
process.chdir(__dirname);
// What the executable holds: the build follows these.
require("dep"); require("only-near"); require("./data/module.cjs"); require("./other/data/module.cjs");
const root = __dirname;
const inside = module.path;
const short = found => String(found).replaceAll("\\", "/").replace(root.replaceAll("\\", "/"), "<root>").replace(inside.replaceAll("\\", "/"), "<root>").replace("node_modules/", "nm/");
const folders = {
  absent: undefined,
  none: [],
  own: [root],
  "own, inside": [inside],
  other: [path.join(root, "other")],
  "other, inside": [path.join(inside, "other")],
  cwd: [process.cwd()],
  "nowhere, then other": [path.join(root, "nowhere"), path.join(root, "other")],
  "other, then own": [path.join(root, "other"), root],
  "own, then other": [root, path.join(root, "other")],
  "third, then inside": [path.join(root, "third"), inside],
  "inside, then third": [inside, path.join(root, "third")],
};
const names = ["dep", "only-near", "only-other", "nobody-has-this", "./data/module.cjs", "./data/on-disk-alone.cjs", "./data/nothing.cjs", "../data/module.cjs", path.join(root, "data", "module.cjs"), path.join(inside, "data", "module.cjs"), "node:fs", "fs"];
for (const name of names) {
  for (const [label, paths] of Object.entries(folders)) {
    let said;
    try {
      said = short(paths === undefined ? require.resolve(name) : require.resolve(name, { paths }));
    } catch (error) {
      said = "threw " + error.code;
    }
    console.log(short(name), "|", label, "|", said);
  }
}
