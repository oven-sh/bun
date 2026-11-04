function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v) { Object.defineProperty(this, "open", { value: v, configurable: true }); Object.defineProperty(this, "shut", { value: v }); Object.defineProperty(this, "soft", { value: v, writable: true }); }
function again(m, how) {
  if (how === 0) return attempt(() => describeAll(Object.defineProperty(m, "open", { value: "new" })));
  if (how === 1) return attempt(() => describeAll(Object.defineProperty(m, "open", { get() { return "got"; } })));
  if (how === 2) return attempt(() => describeAll(Object.defineProperty(m, "open", { enumerable: true, writable: true })));
  if (how === 3) return attempt(() => describeAll(Object.defineProperty(m, "shut", { value: "new" })));
  if (how === 4) return attempt(() => describeAll(Object.defineProperty(m, "shut", { value: m.shut })));
  if (how === 5) return attempt(() => describeAll(Object.defineProperty(m, "shut", { enumerable: true })));
  if (how === 6) return attempt(() => describeAll(Object.defineProperty(m, "soft", { value: "new" })));
  if (how === 7) return attempt(() => describeAll(Object.defineProperty(m, "soft", { writable: false })));
  return attempt(() => describeAll(Object.defineProperty(m, "soft", { get() { return 1; } })));
}
for (let how = 0; how < 9; how++) { let last; for (let i = 0; i < 40; i++) last = again(new Made(i), how); console.log(how, last); }
