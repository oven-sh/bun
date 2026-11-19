class P { x = -1; constructor(x) { this.x = x; } }
class F { constructor(x) { this.x = x; } }
Object.freeze(F.prototype);
function make(C, x) { return new C(x); }
globalThis.kept = make;
function run(n) { let s = 0; for (let i = 0; i < n; i++) s += make(P, i).x * 2 + make(F, i).x; return s; }
console.log(run(Number("6")));
