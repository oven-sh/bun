function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) { Object.defineProperty(this, "fixed", { value: v, enumerable: true }); Object.defineProperty(this, "loose", { value: v, writable: true }); }
function sloppy(m, v) { m.fixed = v; m.loose = v; return m.fixed + ":" + m.loose; }
const said = [];
for (let i = 0; i < 200; i++) { const m = new Made(i); const a = sloppy(m, i + 1000); if (i % 67 === 0) said.push(a, m.fixed, m.loose); }
console.log(said.join());
function bump(m) { m.fixed++; m.fixed += 5; m.loose++; return m.fixed + "," + m.loose; }
console.log(bump(new Made(1)));
