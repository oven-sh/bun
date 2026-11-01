// Other files store into exports and replace module.exports through the module objects they reach.
const out = [];
const a = require("./a.cjs"); out.push(a.x, a.read()); a.x = 2; out.push(a.read()); require("./a.cjs").x = 3; out.push(a.read());
const mod = module.children.find(c => c.id.endsWith("a.cjs")); mod.exports.x = 4; out.push(a.read());
mod.exports = { x: 5, replaced: true }; out.push(require("./a.cjs").x, require("./a.cjs").replaced, a.read(), a.readModule());
module.children.find(c => c.id.endsWith("a.cjs")).exports = { x: 6 }; out.push(require("./a.cjs").x, a.readModule());
const b = require("./b.cjs"); out.push(b(), b.tag); 
const c = require("./c.cjs"); out.push(c.parentSaw);
exports = { local: 1 }; out.push(module.exports.local);
Object.assign(require("./d.cjs"), { v: 9 }); out.push(require("./d.cjs").read());
for (const k in require("./d.cjs")) if (k === "v") require("./d.cjs")[k] = 10; out.push(require("./d.cjs").read());
delete require("./d.cjs").v; out.push(require("./d.cjs").read());
Object.defineProperty(require("./d.cjs"), "v", { get() { return 11; } }); out.push(require("./d.cjs").read());
console.log(JSON.stringify(out));
import("./a.cjs").then(ns => console.log(JSON.stringify([ns.x, ns.default.x, Object.keys(ns).sort().join()])));
