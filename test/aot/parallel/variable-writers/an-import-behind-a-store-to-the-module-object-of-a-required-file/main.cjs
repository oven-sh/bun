// An import() of a CommonJS file sees the exports that another file has stored into its module object by then. Nothing awaits the call: the process does.
const a = require("./a.cjs");
a.x = 2;
module.children.find(child => child.id.endsWith("a.cjs")).exports = { x: 6 };
console.log(require("./a.cjs").x, a.read(), a.readModule());
import("./a.cjs").then(ns => console.log(JSON.stringify([ns.x, ns.default.x, Object.keys(ns).sort().join()])));
