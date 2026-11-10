const out = [];
class Base {  }
class K extends Base { unused() { return 1; } }
class L extends Base {  }
const v = { k: K, l: L };
for (let i = 0; i < 4; i++) { const C = i & 1 ? v.k : v.l; out.push(typeof new C(i)); }
out.push(Object.getOwnPropertyNames(K.prototype).join());
console.log(out.join("|"));
export {};
