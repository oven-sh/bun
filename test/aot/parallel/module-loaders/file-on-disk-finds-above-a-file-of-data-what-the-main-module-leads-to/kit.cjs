const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
exports.sum = function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
};
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "comes-later-"));
fs.writeFileSync(path.join(folder, "late.json"), "{}");
fs.writeFileSync(
  path.join(folder, "stranger.cjs"),
  `const road = (label, walk) => { try { return label + ": " + walk(); } catch (error) { return label + ": throws " + error.name; } };
const above = () => require.cache[__dirname + "/late.json"].parent;
module.exports = () => [
  road("the child of the main module", () => Object.keys(require.main.children[0].exports).join("+") + " " + require.main.children[0].exports.sum("a", "b")),
  road("above the file of data", () => Object.keys(above().exports).join("+") + " " + above().exports.sum("c", "d")),
  road("they are one", () => require.main.children[0] === above()),
  road("above that", () => above().parent === require.main),
];
`,
);
require(path.join(folder, "late.json"));
exports.look = require(path.join(folder, "stranger.cjs"));
fs.rmSync(folder, { recursive: true });
