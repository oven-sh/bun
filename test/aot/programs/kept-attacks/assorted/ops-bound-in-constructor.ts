// Assorted: ops bound in constructor. It prints what plain Bun prints.
class B0 { v = 1; constructor() { this.m = this.m.bind(this); } m(x: number): number { return this.v + x; } }
const b = new B0(); const f = b.m;
console.log(f(1), f.name, Object.keys(b).join(), b.m === b.m, b.m(2));
