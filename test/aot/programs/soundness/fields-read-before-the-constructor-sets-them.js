// A virtual call from a base constructor reads a subclass field before it is set; `this` registered before fields are set.
const registry = [];
class Base {
  constructor() { registry.push(this); this.kind = this.describe(); }
  describe() { return "base"; }
}
class Derived extends Base {
  size = 7;
  constructor(n) { super(); this.n = n; }
  describe() { return "derived:" + this.size + ":" + this.n + ":" + typeof this.size; }
}
const d = new Derived(3);
console.log(d.kind, d.size, d.n, registry[0] === d);
class Late { constructor(cb) { cb(this); this.a = 1; this.b = "x"; } sum() { return this.a + this.b; } }
let seen;
const l = new Late(o => { seen = [o.a, o.b, typeof o.a, "a" in o, Object.keys(o).length, o.sum()]; });
console.log(JSON.stringify(seen), l.sum());
class Ret { constructor(o) { this.z = 1; if (o) return o; } }
class Sub extends Ret { w = 2; constructor(o) { super(o); this.v = 3; } }
const target = { q: 0 };
const s = new Sub(target);
console.log(s === target, JSON.stringify(s), s instanceof Sub, JSON.stringify(new Sub()));
