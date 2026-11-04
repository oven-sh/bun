function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) { Object.defineProperty(this, "x", { value: v, enumerable: true }); }
const values = [undefined, null, 0, -0, NaN, 1.5, 2 ** 40, "text", true, 10n, Symbol.for("s"), [1], { a: 1 }, () => 1];
const said = [];
for (let round = 0; round < 20; round++) for (const v of values) { const m = new Made(v); if (round === 19) said.push(typeof m.x + ":" + String(Object.is(m.x, v)) + ("x" in m) + Object.keys(m).length); }
console.log(said.join());
function Bare() { Object.defineProperty(this, "none", {}); Object.defineProperty(this, "flagged", { enumerable: true }); }
console.log(describeAll(new Bare()), listings(new Bare()));
