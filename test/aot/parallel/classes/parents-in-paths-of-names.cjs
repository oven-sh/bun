// The heritage is a path of names that nobody follows. The class is expected below the one class whose fields its text speaks of, also where that is another one.
// COUNTER: DynamicSubclassInstances <= 8
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
globalThis.table = new Map();
class Base { constructor(n) { this.n = n; this.list = [n]; } add(m) { this.n += m; return this; } get twice() { return this.n * 2; } }
class Other { constructor(a) { this.first = a; } get twice() { return this.first; } add() { return this; } }
class Wrong { constructor() { this.speed = 1; this.weight = 2.5; } }
globalThis.table.set("Base", Base).set("Other", Other);
const lib = { parts: Object.fromEntries(globalThis.table) };
let Chosen = globalThis.table.get(process.argv.length > 0 ? "Base" : "Other");
class Heir extends lib.parts.Base { constructor(n, m) { super(n); this.m = m; this.other = null; } sum() { return this.n + this.m + this.twice + this.list.length; } }
class Fast extends lib.parts.Other { constructor(a) { super(a); this.own = [a]; } go() { return (this.speed || 0) + (this.weight || 0) + this.own.length + this.twice; } }
class Late extends Chosen { constructor(n) { super(n); this.late = n; } sum() { return this.late + this.twice; } }
let total = 0;
for (let i = 0; i < 80; i++) { const h = new Heir(i, 2), f = new Fast(i), l = new Late(i); total += h.add(1).sum() + f.add(1).go() + l.add(2).sum() + (h.other === null ? 1 : 0); }
out.push(total);
for (const object of [new Heir(1, 2), new Fast(3), new Late(4), new Base(5), new Wrong()]) {
  out.push(JSON.stringify(object), Object.keys(object).join(), object instanceof Base, object instanceof Other, object.constructor.name, JSON.stringify({ ...object }));
  object.speed = 7; object.n = "t"; delete object.list; object.m = undefined;
  out.push(JSON.stringify(object), Object.keys(object).join(), "list" in object, show(() => Object.freeze(object).n = 1));
}
Object.defineProperty(Base.prototype, "m", { set(v) { out.push("set" + v); }, configurable: true });
out.push(JSON.stringify(new Heir(1, 2)), new Heir(3, 4).sum()); delete Base.prototype.m;
for (let i = 0; i < 20; i++) new Heir(i, 1);
out.push(JSON.stringify(new Heir(5, 6)), new Heir(5, 6).sum());
Object.setPrototypeOf(Heir, Other); out.push(show(() => JSON.stringify(new Heir(7, 8))), show(() => new Heir(7, 8).sum()));
Object.setPrototypeOf(Heir.prototype, Other.prototype); out.push(show(() => JSON.stringify(new Heir(7, 8))), show(() => new Heir(7, 8).sum()), new Heir(1, 2) instanceof Base);
class Below extends Heir { extra = 1; sum() { return this.m + this.extra; } } out.push(JSON.stringify(new Below(1, 2)), new Below(1, 2).sum());
for (const line of out) console.log(String(line));
