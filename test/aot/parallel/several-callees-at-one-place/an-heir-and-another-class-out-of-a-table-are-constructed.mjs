class P { m() { return 5; } } class A extends P { constructor(n) { super(); this.n = n; } } class B { constructor(n) { this.n = n + 1; } m() { return 2; } }
const t = { a: A, b: B }; const pick = i => i & 1 ? t.a : t.b; let s = 0; for (let i = 0; i < 4; i++) s += new (pick(i))(i).n; console.log(s);
