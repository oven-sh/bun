const out = [];
class Base {  }
class K extends Base { constructor(n) { super(n); this.n = n; } unused() { return 1; } }
class L extends Base { constructor(n) { super(n); this.m = n; } }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
console.log(out.join("|"));
export {};
