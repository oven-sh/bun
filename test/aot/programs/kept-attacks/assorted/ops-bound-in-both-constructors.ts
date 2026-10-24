// Assorted: ops bound in both constructors. It prints what plain Bun prints.
class B0 { v = 1; constructor() { this.m = this.m.bind(this); } m(x: number): number { return this.v + x; } }
class D0 extends B0 { constructor() { super(); this.m = this.m.bind(this); } }
const b = new B0(); const f = b.m;
console.log(f(1), f.name, Object.keys(b).join(), b.m === b.m, b.m(2));
const d = new D0(); const g = d.m;
console.log(g(1), g.name, g.length, d.m(2));
