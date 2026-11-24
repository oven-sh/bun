class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } } const t = { a: A, b: B };
function use(K, n) { let s = 0; for (let i = 0; i < n; i++) s += new K(i & 3).n + (K.tag ?? 0); return s; } console.log(use(t.a, 200) + use(t.b, 200));
