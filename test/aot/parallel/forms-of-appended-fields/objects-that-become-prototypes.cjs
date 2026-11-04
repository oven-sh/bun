function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Above(v) { Object.defineProperty(this, "shared", { value: v }); Object.defineProperty(this, "got", { get() { return this.own + v; } }); }
function Below(own) { this.own = own; }
const said = [];
for (let i = 0; i < 60; i++) {
  const above = new Above(i);
  const below = Object.create(above); below.own = 1;
  below.shared = "shadow";
  if (i === 59) said.push(below.shared, below.got, Object.keys(below).join());
}
Below.prototype = new Above(100);
const b = new Below(5);
Object.defineProperty(Below.prototype, "late", { value: "late" });
console.log(said.join(), b.shared, b.got, b.late, describeAll(Below.prototype));
