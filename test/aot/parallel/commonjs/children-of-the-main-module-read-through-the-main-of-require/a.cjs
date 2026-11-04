const base = m => (m && typeof m === "object" && typeof m.id === "string" ? m.id.split("/").pop() : String(m));
const c = require("./c.cjs");
const d = require("./d.cjs");
exports.report = () => [
  require.main.children.map(base).join(),
  require.main.children.map(child => base(child) + ":" + child.children.map(base).join("+")).join(),
  require.main.children.map(child => base(child.parent)).join(),
  base(require.main),
  String(require.main.parent),
  require.main.loaded,
  c.name + d.name,
];
