const out = [];
class Base { constructor(n) { this.n = n; } }
class K extends Base { unused() { return 1; } }
class L extends Base {}
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
const any = JSON.parse("1"); const t = { h: C => C.length }; function pick(x) { switch (x) { case K: return t.h(x); default: return -1; } } out.push(pick(any), pick(K), (any ? t : null).h(K));
console.log(out.join("|"));
export {};
