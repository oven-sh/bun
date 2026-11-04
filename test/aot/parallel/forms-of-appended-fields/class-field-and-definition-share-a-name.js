function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

class Both { x = 1; constructor(v) { Object.defineProperty(this, "x", { value: v, enumerable: false }); } }
class Other { constructor(v) { Object.defineProperty(this, "y", { value: v }); } }
class Under extends Other { y = "field"; }
console.log(describeAll(new Both(5)), attempt(() => describeAll(new Under(5))));
let text = ""; for (let i = 0; i < 50; i++) text = describeAll(new Both(i)) + attempt(() => describeAll(new Under(i)));
console.log(text);
