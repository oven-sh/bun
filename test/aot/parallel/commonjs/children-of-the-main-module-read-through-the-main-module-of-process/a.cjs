const base = m => (m && typeof m === "object" && typeof m.id === "string" ? m.id.split("/").pop() : String(m));
const c = require("./c.cjs");
const d = require("./d.cjs");
exports.report = () => [
  process.mainModule.children.map(base).join(),
  process.mainModule.children.map(child => base(child) + ":" + child.children.map(base).join("+")).join(),
  process.mainModule.children.map(child => base(child.parent)).join(),
  base(process.mainModule),
  String(process.mainModule.parent),
  process.mainModule.loaded,
  c.name + d.name,
];
