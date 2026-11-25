class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } } const t = { a: A, b: B };
const fs = { f: (K, i) => new K(i).n, g: (K, i) => new K(i).n + 1 }; let s = 0, z = 0; for (let i = 0; i < 4; i++) { s += (i & 1 ? fs.f : fs.g)(t.a, i); z += new (i & 1 ? t.a : t.b)(i).n; } console.log(s, z);
