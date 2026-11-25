const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
exports.sum = function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
};
exports.loadHelper = function loadHelper() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "comes-later-"));
  fs.writeFileSync(
    path.join(folder, "helper.cjs"),
    `module.exports = () => [Object.keys(module.parent.exports).join("+"), module.parent.exports.sum("a", "b"), typeof module.parent.require, module.parent.children.includes(module), module.parent.loaded].join(" ");`,
  );
  const helper = require(path.join(folder, "helper.cjs"));
  fs.rmSync(folder, { recursive: true });
  return helper;
};
