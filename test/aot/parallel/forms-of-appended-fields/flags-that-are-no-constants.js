function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v, flag) { Object.defineProperty(this, "x", { value: v, enumerable: flag, writable: !flag }); Object.defineProperty(this, "y", { value: v, enumerable: 1, configurable: "" , writable: null }); }
const said = [];
for (let i = 0; i < 60; i++) { const m = new Made(i, (i & 1) === 1); if (i > 57) said.push(describeAll(m), listings(m)); }
console.log(said.join("\n"));
