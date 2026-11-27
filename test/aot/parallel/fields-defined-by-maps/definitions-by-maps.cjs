const show = v => typeof v === "function" ? "function" : v && typeof v === "object" ? "{" + Object.keys(v).join() + "}" : String(v);
const describe = o => Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + (d.get || d.set ? ":accessor" : ":" + show(d.value)) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" ");
class Point { constructor(x, y) { this.x = x; this.y = y; } }
let next = 0;
class Node {
  constructor(name) {
    this.isNode = true;
    Object.defineProperty(this, "id", { value: next++ });
    this.name = name;
    const position = new Point(next, 2);
    Object.defineProperties(this, {
      position: { configurable: true, enumerable: true, value: position },
      scale: { value: new Point(1, 1) },
      weight: { writable: true, enumerable: true, configurable: true, value: 0.5 },
    });
    this.children = [];
  }
  move(dx) { this.position.x += dx; this.scale.y *= 2; this.weight += dx; return this; }
  total() { let t = this.position.x * this.scale.y + this.weight; for (const child of this.children) t += child.total(); return t; }
}
class Leaf extends Node {
  constructor(name, depth) {
    super(name);
    Object.defineProperties(this, { depth: { value: depth, writable: true }, ["late" + depth]: { value: depth, enumerable: true }, __proto__: null });
    this.kind = "leaf";
  }
}
class Twice extends Node {
  constructor(name) {
    super(name);
    try { Object.defineProperties(this, { position: { value: 7 }, scale: { value: 8 }, extra: { value: 9 } }); } catch (e) { this.failed = e.name; }
  }
}
class Accessors {
  constructor(flag) {
    if (flag) Object.defineProperties(this, { a: { get() { return 1; } }, b: { value: 2 } });
    this.b2 = 3;
    try { this.b = 4; } catch (e) { this.failed = e.name; }
  }
}
class Spread { constructor(...maps) { Object.defineProperties(this, ...maps); this.after = 1; } }
class Shared { constructor() { Object.defineProperties(this, Shared.map); this.z = this.x; } }
Shared.map = { x: { value: 1, enumerable: true }, y: { value: 2 } };
function Old(v) { Object.defineProperties(this, { v: { value: v, enumerable: true }, w: { value: v + 1, writable: true } }); this.u = 1; }
Old.prototype.sum = function () { return this.v + this.w + this.u; };
class Throws { constructor(n) { this.first = 1; try { Object.defineProperties(this, { p: { value: 1 }, q: n ? { value: 2, get() {} } : { value: 2 }, r: { value: 3 } }); } catch (e) { this.caught = e.name; } this.last = 2; } }
const nodes = [];
for (let i = 0; i < 40; i++) { const n = i % 3 === 0 ? new Leaf("l" + i, i % 2) : i % 7 === 1 ? new Twice("t" + i) : new Node("n" + i); nodes.push(n); if (i) nodes[(i - 1) >> 1].children.push(n); }
for (let turn = 0; turn < 5; turn++) for (const n of nodes) { try { n.move(0.25); } catch (e) { console.log(n.name, e.name); } }
console.log(nodes[0].total(), nodes.map(n => n.id).join());
for (const o of [nodes[0], nodes[1], nodes[2], nodes[3], new Accessors(true), new Accessors(false), new Spread({ a: { value: 1, enumerable: true } }), new Shared(), new Old(3), new Throws(0), new Throws(1)]) console.log(o.constructor.name, describe(o), JSON.stringify(Object.keys(o)));
console.log(new Old(4).sum());
for (const key of ["position", "scale", "weight", "id"]) console.log(key, Reflect.set(nodes[1], key, 5), show(nodes[1][key]));
try { delete nodes[2].position; console.log("position" in nodes[2], describe(nodes[2])); } catch (e) { console.log(e.name); }
Object.defineProperty(nodes[4], "position", { value: new Point(100, 1), writable: true });
console.log(nodes[4].position.x, describe(nodes[4]));
for (const k in nodes[5]) console.log(k);
console.log({ ...nodes[6] }.position === nodes[6].position, Object.assign({}, nodes[6]).scale);
try { new Spread(); } catch (e) { console.log(e.name); }
try { new Spread({ a: 1 }); } catch (e) { console.log(e.name); }
