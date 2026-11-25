class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } } const t = { a: A, b: B };
const mk = K => ({ K }); function use(o, n) { let s = 0; for (let i = 0; i < n; i++) s += new o.K(i & 3).n; return s; } console.log(use(mk(A), 200) + use(mk(B), 200));
