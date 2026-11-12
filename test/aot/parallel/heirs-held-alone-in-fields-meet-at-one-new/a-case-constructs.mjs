const out = [];
class Base { constructor(n) { this.n = n; } }
class K extends Base { unused() { return 1; } }
class L extends Base {}
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
const any = JSON.parse("1"); const h = C => new C(2).n; function pick(x) { switch (x) { case K: return h(x); default: return 0; } } out.push(pick(any), pick(null));
console.log(out.join("|"));
export {};
