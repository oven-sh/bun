class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } }
const t = { a: A, b: B }; let hits = 0; function f(C, i) { if (C === t.a) hits++; const o = new C(i); return o.n; }
let s = 0; for (let i = 0; i < 4; i++) s += f(i & 1 ? t.a : t.b, i); console.log(s, hits);
