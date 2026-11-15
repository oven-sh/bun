class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } } const t = { a: A, b: B };
const l = [A, B]; function use(l, n) { let s = 0; for (let i = 0; i < n; i++) { const K = l[i & 1]; s += new K(i & 3).n; } return s; } console.log(use(l, 400));
