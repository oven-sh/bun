const out = [];
class Base { constructor(n) { this.n = n; } }
class K extends Base { unused() { return 1; } }
class L extends Base {}
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
const any = JSON.parse("1"); const h = C => C.name; function pick(x) { switch (x) { case K: return h(x); case L: return h(x); default: return "no"; } } for (const x of [any, K, 5]) out.push(pick(x));
console.log(out.join("|"));
export {};
