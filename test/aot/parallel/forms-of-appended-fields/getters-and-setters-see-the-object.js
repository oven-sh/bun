function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

const log = [];
function Made(v) {
  Object.defineProperty(this, "value", { get() { log.push("get" + (this === made)); return v; }, set(x) { log.push("set" + x + (this === made)); v = x; }, enumerable: true });
}
let made;
for (let i = 0; i < 3; i++) { made = new Made(i); made.value = made.value + 10; made.value++; }
console.log(log.join(), made.value, JSON.stringify(made), Object.values(made).join());
function Throws() { Object.defineProperty(this, "bad", { get() { throw new RangeError("bad"); }, enumerable: true }); }
console.log(attempt(() => new Throws().bad), attempt(() => JSON.stringify(new Throws())), attempt(() => ({ ...new Throws() })), Object.keys(new Throws()).join());
