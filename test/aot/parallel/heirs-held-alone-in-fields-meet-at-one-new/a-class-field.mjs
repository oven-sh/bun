const out = [];
class Base {  }
class K extends Base { unused() { return 1; } }
class L extends Base {  }
class T { k = K; l = L; } const t = new T();
for (let i = 0; i < 4; i++) { const C = i & 1 ? t.k : t.l; out.push(typeof new C(i)); }
console.log(out.join("|"));
export {};
