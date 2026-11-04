function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v, how) {
  if (how & 1) Object.defineProperty(this, "p", { value: v, enumerable: true });
  Object.defineProperty(this, "q", { value: v + 1, enumerable: true });
  if (!(how & 1)) Object.defineProperty(this, "p", { value: v, enumerable: true });
  if (how & 2) Object.defineProperty(this, "r", { get() { return v + 2; }, enumerable: true });
  this.s = v + 3;
}
const said = [];
for (let i = 0; i < 200; i++) { const m = new Made(i, i & 3); if (i >= 196) said.push(describeAll(m) + " " + listings(m) + " " + (m.p + m.q + (m.r | 0) + m.s)); }
console.log(said.join("\n"));
