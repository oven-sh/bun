class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } }
const t = [{ C: A }, { C: B }]; const same = (p, q) => p.C === q.C ? 1 : 0; const make = (C, i) => new C(i).n;
let s = 0, e = 0; for (let i = 0; i < 400; i++) { s += make(t[i & 1].C, i & 3); e += same(t[i & 1], t[0]); } console.log(s, e);
