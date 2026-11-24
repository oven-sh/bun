// for (const x of this.items(..)): arguments and default parameters change what the generators inherit.
const run = f => { try { return String(f()); } catch (e) { return e.name; } };
let change = () => {};
class ByArgument {
  constructor(n) { this.n = n; }
  *items() { for (let i = 0; i < this.n; i++) yield i; }
  join() { let s = ""; for (const x of this.items(change())) s += x; return s; }
}
class ByDefault {
  constructor(n) { this.n = n; }
  *items(a = change()) { for (let i = 0; i < this.n; i++) yield i; }
  join() { let s = ""; for (const x of this.items()) s += x; return s; }
}
globalThis.known = [ByArgument, ByDefault];

const other = prototype => ({ __proto__: prototype, next() { const done = this.stepped; this.stepped = true; return { done, value: "other" }; } });
for (const C of [ByArgument, ByDefault]) {
  const { items } = C.prototype, written = items.prototype;
  console.log(run(() => new C(3).join()));
  change = () => { items.prototype = other(written); };
  console.log(run(() => new C(3).join()), run(() => new C(2).join()));
  items.prototype = written;
  change = () => { written[Symbol.iterator] = function () { return ["iterator"][Symbol.iterator](); }; };
  console.log(run(() => new C(3).join()));
  delete written[Symbol.iterator];
  change = () => { C.prototype.items = function* () { yield "replaced"; }; };
  console.log(run(() => new C(3).join()), run(() => new C(3).join()));
  change = () => {};
}
