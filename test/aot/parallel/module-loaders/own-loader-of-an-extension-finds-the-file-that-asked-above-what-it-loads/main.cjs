// A loader in require.extensions is handed the module object of what it loads. The parent of that is the module object of the file that asked: its exports, its require, its own parent and its children.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asks = require("./asks.cjs");
let total = 0;
for (let i = 0; i < 300; i++) total = asks.sum(total, i) | 0;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "comes-later-"));
fs.writeFileSync(path.join(folder, "late.json"), "{}");
let above;
require.extensions[".json"] = function load(made) {
  above = made.parent;
  made.exports = [path.basename(above.id), Object.keys(above.exports).join("+"), above.exports === asks, above.exports.sum("a", "b"), typeof above.require, above.parent === module, above.children.length].join(" ");
};
console.log(total, asks.load(path.join(folder, "late.json")));
console.log(above.children.map(child => path.basename(child.id)).join("+"), above.children[0].parent === above, above === asks.own());
fs.rmSync(folder, { recursive: true });
