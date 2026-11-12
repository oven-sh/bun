// The file that asks is amid its body: its module object shows what it has exported so far, and later the rest. One that throws behind the load keeps what it had. An ES module that asks has no exports to show.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "comes-later-"));
for (const name of ["first.json", "second.json", "third.json"]) fs.writeFileSync(path.join(folder, name), "{}");
globalThis.folderOfLateFiles = folder;
const seen = [];
require.extensions[".json"] = function load(made) {
  seen.push(made.parent);
  made.exports = path.basename(made.parent.id) + " " + made.parent.loaded + " " + typeof made.parent.exports + " " + Object.keys(made.parent.exports ?? {}).join("+");
};
const runs = require("./still-runs.cjs");
console.log(runs.answer, "|", Object.keys(seen[0].exports).join("+"), seen[0].exports === runs, seen[0].loaded);
try {
  require("./gives-up.cjs");
} catch (error) {
  console.log(error.message, "|", Object.keys(seen[1].exports).join("+"), seen[1].exports.answer, seen[1].loaded);
}
import("./asks.mjs").then(asks => {
  console.log(asks.answer, "|", seen[2].loaded, typeof seen[2].exports, typeof seen[2].require);
  fs.rmSync(folder, { recursive: true });
});
