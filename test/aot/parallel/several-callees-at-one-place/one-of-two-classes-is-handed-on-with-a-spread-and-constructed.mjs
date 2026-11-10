class A { constructor(n) { this.n = n; } m() { return 1; } } class B { constructor(n) { this.n = n; } m() { return 2; } }
function make(C, ...a) { return new C(a[0]); } let s = ""; for (let i = 0; i < 4; i++) { const got = make(i & 1 ? A : B, ...[i]); s += got.n + got.constructor.name; } console.log(s);
