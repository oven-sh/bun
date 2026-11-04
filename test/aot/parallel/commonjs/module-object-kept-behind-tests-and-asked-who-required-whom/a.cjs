const base = m => (m && typeof m === "object" && typeof m.id === "string" ? m.id.split("/").pop() : String(m));
const c = require("./c.cjs");
const d = require("./d.cjs");
var kept = typeof module == "object" && module;
var other = typeof module == "object" && module && !module.nodeType && module;
function look(m, key) { return m[key].length; }
exports.report = () => [kept.children.map(base).join(), base(kept.parent), look(other, ["chil", "dren"].join("")), base(other.parent.children[0]), c.name + d.name];
