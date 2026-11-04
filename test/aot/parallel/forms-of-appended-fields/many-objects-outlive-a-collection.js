function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) { Object.defineProperty(this, "pair", { get() { return v; }, set(x) { v = x; } }); Object.defineProperty(this, "held", { value: { v } }); }
const kept = [];
for (let i = 0; i < 20000; i++) { const m = new Made(i); if (i % 100 === 0) kept.push(m); }
Bun.gc(true);
let sum = 0; for (const m of kept) { m.pair += 1; sum += m.pair + m.held.v; }
console.log(sum, kept.length);
