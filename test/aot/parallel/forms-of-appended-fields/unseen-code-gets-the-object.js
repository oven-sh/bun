function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

const unseen = (0, eval);
function Made(v) { Object.defineProperty(this, "fixed", { value: v }); Object.defineProperty(this, "open", { value: v, configurable: true, writable: true }); }
const change = unseen("(o) => { o.fixed = 'changed'; o.open = 'changed'; Object.defineProperty(o, 'open', { get() { return 'got'; } }); o.added = 1; return Object.getOwnPropertyNames(o).join(); }");
const said = [];
for (let i = 0; i < 40; i++) { const m = new Made(i); const names = i > 37 ? change(m) : ""; if (i > 36) said.push(names, m.fixed, m.open, describeAll(m)); }
console.log(said.join(" "));
