const out = [];
class Base {  }
class K extends Base { unused() { return 1; } }
class L extends Base {  }
const v = { k: K, l: L }; const pick = i => i & 1 ? v.k : v.l;
for (let i = 0; i < 4; i++) { const C = pick(i); out.push(typeof new C(i)); }
console.log(out.join("|"));
export {};
