function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function First() { tag(this, 1); this.own = 1; }
function Second() { this.own = 2; tag(this, 2); }
function tag(o, v) { Object.defineProperty(o, "tag", { value: v }); Object.defineProperty(o, "name", { get() { return "n" + this.tag; }, enumerable: true }); }
let text = "";
for (let i = 0; i < 100; i++) { const o = i & 1 ? new First() : new Second(); text = o.tag + o.name + describeAll(o) + listings(o) + text.slice(0, 120); }
console.log(text);
tag({}, 3); console.log(attempt(() => tag(Object.freeze({}), 4)), attempt(() => tag(5, 5)), attempt(() => tag(new Proxy({}, { defineProperty() { return false; } }), 6)));
