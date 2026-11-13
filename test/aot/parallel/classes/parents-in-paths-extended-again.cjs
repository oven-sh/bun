// A class whose heritage is a path of names that nobody follows is expected below the class whose fields its text speaks of, also where a class of the program extends it.
// COUNTER: DynamicSubclassInstances <= 1
"use strict";
globalThis.table = new Map();
class Base { constructor(n) { this.n = n; this.list = [n]; } add(m) { this.n += m; return this; } get twice() { return this.n * 2; } }
globalThis.table.set("Base", Base);
const lib = { parts: Object.fromEntries(globalThis.table) };
class Heir extends lib.parts.Base { constructor(n, m) { super(n); this.m = m; this.other = null; } sum() { return this.n + this.m + this.twice + this.list.length; } }
class Below extends Heir { constructor(n) { super(n, 1); this.extra = n; } sum() { return super.sum() + this.extra; } }
let total = 0;
for (let i = 0; i < 80; i++) { const h = new Heir(i, 2), b = new Below(i); total += h.add(1).sum() + b.add(2).sum() + (h.other === null ? 1 : 0); }
console.log(total);
for (const object of [new Heir(1, 2), new Below(3)]) {
  console.log(JSON.stringify(object), Object.keys(object).join(), object instanceof Base, object instanceof Heir, object.constructor.name);
  object.n = "t"; delete object.list; object.m = undefined;
  console.log(JSON.stringify(object), Object.keys(object).join(), "list" in object);
}
Object.setPrototypeOf(Heir, class { constructor(n) { this.first = n; } });
console.log(JSON.stringify(new Heir(5, 6)), JSON.stringify(new Below(7)), new Below(7) instanceof Base);
