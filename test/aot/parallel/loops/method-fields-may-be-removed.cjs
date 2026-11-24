"use strict";
// Fields that methods fill before a loop, and that something takes out, locks, defines anew or gives to others.
const out = [];
const show = (f) => { try { const r = f(); return typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
function makeClass() {
  return {
    Deleted: class { start() { this.n = 0; this.m = 1; } run(k) { while (k--) { this.n++; this.m += this.n; if (k === 2) delete this.n; } return [this.n, this.m, Object.keys(this).join()]; } },
    Frozen: class { start() { this.n = 0; } run(k) { while (k--) { if (k === 2) Object.freeze(this); this.n++; } return this.n; } },
    Closed: class { start() { this.n = 0; } late(k) { while (k--) { if (k === 2) Object.preventExtensions(this); this.late2 = (this.late2 || 0) + 1; this.n++; } return [this.n, this.late2]; } },
    Locked: class { start() { this.n = 0; } run(k) { while (k--) { if (k === 2) Object.defineProperty(this, "n", { writable: false }); this.n++; } return this.n; } },
    Accessor: class { start() { this.n = 0; } run(k) { let seen = 0; while (k--) { if (k === 2) Object.defineProperty(this, "n", { get() { return 40; }, set(v) { seen += v; }, configurable: true }); this.n++; } return [this.n, seen]; } },
    Text: class { start(v) { this.n = v; } run(k) { while (k--) { this.n += 1; } return this.n; } },
    Keyed: class { start() { this.n = 0; } run(k, key) { while (k--) { this.n++; this[key] = "k"; } return this.n; } },
    Reflected: class { start() { this.n = 0; } run(k) { while (k--) { this.n++; if (k === 1) Reflect.deleteProperty(this, "n"); } return [this.n, "n" in this]; } },
  };
}
for (const [name, Class] of Object.entries(makeClass())) {
  for (const begins of [true, false]) {
    for (const k of [0, 1, 5]) {
      const object = new Class();
      if (begins) object.start(name === "Text" ? "t" : 0);
      out.push([name, begins, k, show(() => (object.run || object.late).call(object, k, "n")), show(() => Object.keys(object).join()), show(() => object.n)].join(" "));
    }
  }
}
// A setter above takes the first store; a getter above answers while there is no field.
class Above { start() { this.n = 1; } run(k) { let sum = 0; while (k--) { sum += this.n; this.n++; } return [sum, this.n, Object.keys(this).join()]; } }
for (let round = 0; round < 3; round++) {
  if (round === 1) Object.defineProperty(Above.prototype, "n", { get() { return 10; }, set(v) { this.kept = v; }, configurable: true });
  if (round === 2) { delete Above.prototype.n; Above.prototype.n = 5; }
  for (const begins of [true, false]) { const object = new Above(); if (begins) object.start(); out.push("above " + round + begins + show(() => object.run(3))); }
}
// Generators, async functions and eval texts between the store and the loop.
class Steps { start() { this.n = 0; } *run(k) { for (let i = 0; i < k; i++) { this.n++; yield this.n; } } async later(k) { for (let i = 0; i < k; i++) { this.n++; await null; } return this.n; } }
const steps = new Steps();
steps.start();
const walk = steps.run(5);
walk.next(); walk.next(); delete steps.n; out.push("steps " + show(() => walk.next().value) + show(() => walk.next().value));
(0, eval)("globalThis.touch = (o) => { delete o.n; }");
class Touched { start() { this.n = 0; } run(k) { while (k--) { this.n++; if (k === 2) globalThis.touch(this); } return [this.n]; } }
{ const t = new Touched(); t.start(); out.push("touched " + show(() => t.run(5)) + show(() => t.run(2))); }
class Again { start() { this.n = 0; this.depth = 0; } run(k) { if (++this.depth > 3) { throw new RangeError("deep"); } for (let i = 0; i < k; i++) { this.n++; if (i === 1) this.run(k); } return this.n; } }
{ const a = new Again(); a.start(); out.push("again " + show(() => a.run(3)) + a.n + a.depth); }
const proxied = new Proxy(new Again(), { set(target, key, value) { target[key] = value; out.push("set " + String(key)); return true; } });
out.push(show(() => proxied.start()) + show(() => proxied.run(1)));
steps.start();
steps.later(3).then((n) => { out.push("later " + n); for (const line of out) console.log(line); });
