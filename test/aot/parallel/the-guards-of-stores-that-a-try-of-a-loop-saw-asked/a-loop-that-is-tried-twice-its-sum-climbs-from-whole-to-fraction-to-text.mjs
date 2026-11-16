class P { constructor(x) { this.x = x; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
function run(n) { let s = 0; for (let i = 0; i < n; i++) { const o = make(P, i); s = i === 2 ? s + 0.5 : i === 4 ? s + "!" : s + o.x; } return s; }
console.log(run(Number("3")), run(Number("4")), run(Number("7")));
