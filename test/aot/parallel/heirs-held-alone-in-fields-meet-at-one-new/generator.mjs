const out = [];
class Base { constructor(n) { this.n = n; } }
class K extends Base { *unused() { yield 1; } }
class L extends Base {  }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
console.log(out.join("|"));
export {};
