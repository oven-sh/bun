const out = [];
class Base {  }
class K extends Base { unused() { return 1; } }
class L extends Base {  }
class M extends K { also() { return 2; } }
const w = { m: M, k: K };
for (let i = 0; i < 2; i++) { const C = i & 1 ? w.m : w.k; out.push(typeof new C()); }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
console.log(out.join("|"));
export {};
