const k = JSON.parse('"q"'); class A { constructor(n) { this.n = n; } [k]() { return 1; } #p() { return 1; } has(o) { return #p in o; } } class B { constructor(n) { this.n = n; } [k]() { return 2; } }
const t = { a: A, b: B }; const pick = i => i & 1 ? t.a : t.b; let s = 0; for (let i = 0; i < 4; i++) s += new (pick(i))(i).n; console.log(s);
