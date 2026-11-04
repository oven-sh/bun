function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) { Object.defineProperty(this, "stays", { value: v }); Object.defineProperty(this, "goes", { value: v, configurable: true }); Object.defineProperty(this, "got", { get() { return v; } }); }
const said = [];
for (let i = 0; i < 100; i++) {
  const m = new Made(i);
  const line = [delete m.stays, delete m.goes, delete m.got, "stays" in m, "goes" in m, m.goes, m.got, describeAll(m)].join(" ");
  if (i % 49 === 0) said.push(line);
}
console.log(said.join("\n"));
const again = new Made(1); delete again.goes; Object.defineProperty(again, "goes", { value: 9, configurable: true }); again.plain = 1; console.log(describeAll(again));
