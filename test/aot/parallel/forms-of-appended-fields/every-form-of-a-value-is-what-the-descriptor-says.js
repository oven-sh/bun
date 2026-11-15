function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) {
  Object.defineProperty(this, "a", { value: v });
  Object.defineProperty(this, "b", { value: v, writable: true });
  Object.defineProperty(this, "c", { value: v, enumerable: true });
  Object.defineProperty(this, "d", { value: v, configurable: true });
  Object.defineProperty(this, "e", { value: v, writable: true, enumerable: true });
  Object.defineProperty(this, "f", { value: v, writable: true, configurable: true });
  Object.defineProperty(this, "g", { value: v, enumerable: true, configurable: true });
  Object.defineProperty(this, "h", { value: v, writable: true, enumerable: true, configurable: true });
}
let sum = 0;
for (let i = 0; i < 300; i++) { const m = new Made(i); sum += m.a + m.b + m.c + m.d + m.e + m.f + m.g + m.h; }
const one = new Made(7);
console.log(sum, describeAll(one));
console.log(listings(one));
