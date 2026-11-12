function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

class Point { constructor(x) { this.x = x; Object.defineProperty(this, "hidden", { value: x * 2 }); } get twice() { return this.hidden; } }
class Below extends Point { constructor(x) { super(x); Object.defineProperty(this, "more", { get: () => this.hidden + 1, enumerable: true }); } }
function literal(v) { const o = { a: v }; Object.defineProperty(o, "b", { value: v + 1 }); return Object.defineProperty(o, "c", { value: v + 2, enumerable: true, writable: true }); }
let sum = 0;
for (let i = 0; i < 300; i++) { const p = new Point(i), q = new Below(i), l = literal(i); sum += p.hidden + p.twice + q.more + q.hidden + l.a + l.b + l.c; l.c = 1; l.b = 1; sum += l.b + l.c; }
console.log(sum, describeAll(new Point(1)), describeAll(new Below(1)), describeAll(literal(1)), listings(new Below(2)), listings(literal(2)));
