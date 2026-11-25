class P { constructor(x) { this.x = x; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
function run(n) { let s = 0, t = 0; for (let i = 0; i < n; i++) s += make(P, i).x; for (let i = 0; i < n; i++) t += i * 2; for (let i = 0; i < n; i++) s += make(P, t + i).x; return s + t; }
console.log(run(Number("7")));
