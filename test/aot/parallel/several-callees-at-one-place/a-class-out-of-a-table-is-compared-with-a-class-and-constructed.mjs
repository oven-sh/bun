class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } }
const t = { a: A, b: B }; let hits = 0; function make(C, i) { if (C === A) hits++; return new C(i); } let s = 0; for (let i = 0; i < 400; i++) s += make(i & 1 ? t.a : t.b, i & 3).n; console.log(s, hits);
