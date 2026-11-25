// Getters that only return a field: the same name in several classes, over unions, unknown objects, keys and heirs, and what changes them.
class Node { constructor(k) { this._k = k; } get k() { return this._k; } get kind() { return this._kind; } }
class A extends Node { constructor(k, b) { super(k); this._b = b; } get b() { return this._b; } }
class B extends Node { constructor(k, b) { super(k); this._pad = 0; this._b = b; } get b() { return this._b; } }
class C extends Node { constructor(k, b) { super(k); this._p = 1.5; this._q = "q"; this._b = b; this._kind = "c"; } get b() { return this._b; } set b(v) { this._b = v; } }
class D extends Node { constructor(k, b) { super(k); if (k & 1) this._b = b; } get b() { return this._b; } }
class E extends A { constructor(k, b) { super(k, b); this._e = b; } get b() { return this._e; } }
const classes = [A, B, C, D, E];
const nodes = [];
for (let i = 0; i < 40; i++) nodes.push(new classes[i % 5](i, i % 7 === 6 ? undefined : i % 3 ? i : "s" + i));
function typed(list) { let s = ""; for (let i = 0; i < list.length; i++) s += list[i].b + ","; return s; }
function sum(list) { let t = 0; for (const n of list) { if (n.b) t += 1; t += n.k; if (typeof n.kind === "string") t += 1000; } return t; }
function one(n, times) { let s = 0; for (let i = 0; i < times; i++) s += n.k + (n.b === undefined ? 1 : 2); return s; }
globalThis.held = { nodes, classes, typed, sum, one };
const { held } = globalThis;
function unknown(o) { return [o.b, o.k, o.kind, "b" in o, Object.hasOwn(o, "b"), Object.hasOwn(o, "_b"), Object.keys(o).length].map(String).join(); }
const keys = ["b", "k", "kind", "_b"];
function byKey(o) { let s = ""; for (const key of keys) s += o[key] + "" + (key in o) + Object.hasOwn(o, key) + ";"; return s; }
function show(round) {
  console.log(round, held.typed(held.nodes), held.sum(held.nodes), held.one(held.nodes[2], 5), held.one(held.nodes[3], 5));
  for (let i = 0; i < 10; i++) console.log(unknown(held.nodes[i]), byKey(held.nodes[i]));
  for (let t = 0; t < 30; t++) for (let i = 0; i < 10; i++) unknown(held.nodes[i]), byKey(held.nodes[i]);
}
show("made");
held.nodes[0]._b = "stored"; held.nodes[2].b = "set"; delete held.nodes[1]._b;
show("stored");
Object.defineProperty(held.nodes[5], "_b", { get() { return "field got " + this.k; }, configurable: true });
Object.defineProperty(held.nodes[6], "b", { value: "own" });
show("own");
Object.defineProperty(held.classes[1].prototype, "b", { get() { return "other " + this._b; }, configurable: true });
show("redefined");
Object.defineProperty(held.classes[3].prototype, "b", { get() { return this._k; }, configurable: true });
show("another field");
delete held.classes[4].prototype.b;
show("deleted");
Object.setPrototypeOf(held.nodes[0], { b: "above", k: "above k", __proto__: A.prototype });
Object.setPrototypeOf(held.nodes[7], null);
Object.freeze(held.nodes[8]);
A.prototype._b = "from the prototype";
delete held.nodes[10]._b;
show("chains");
Object.setPrototypeOf(held.classes[2].prototype, { get k() { return "k of another"; }, get kind() { return this._q; } });
show("parents");
