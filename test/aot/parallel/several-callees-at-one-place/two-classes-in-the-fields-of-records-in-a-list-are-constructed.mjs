class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } }
const t = [{ C: A }, { C: B }]; function g(p, i) { return new p.C(i).n; }
let s = 0; for (let i = 0; i < 400; i++) s += g(t[i & 1], i & 3); console.log(s);
