const out = [];
class Base { constructor(n) { this.n = n; } }
class K extends Base { unused() { return 1; } }
class L extends Base {}
const v = { a: { k: K }, b: { l: L } };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.a.k : v.b.l; out.push(typeof new C(i)); }
console.log(out.join("|"));
export {};
