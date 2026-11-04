function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) {
  this.held = v;
  Object.defineProperty(this, "a", { get() { return this.held + 1; } });
  Object.defineProperty(this, "b", { get() { return this.held + 2; }, enumerable: true });
  Object.defineProperty(this, "c", { get() { return this.held + 3; }, configurable: true });
  Object.defineProperty(this, "d", { get() { return this.held + 4; }, set(x) { this.held = x; }, enumerable: true, configurable: true });
  Object.defineProperty(this, "e", { set(x) { this.held = x * 2; } });
}
let sum = 0;
for (let i = 0; i < 300; i++) { const m = new Made(i); sum += m.a + m.b + m.c + m.d; m.d = 5; sum += m.a; m.e = 4; sum += m.b + (m.e === undefined ? 1 : 0); }
const one = new Made(7);
console.log(sum, describeAll(one));
console.log(listings(one));
