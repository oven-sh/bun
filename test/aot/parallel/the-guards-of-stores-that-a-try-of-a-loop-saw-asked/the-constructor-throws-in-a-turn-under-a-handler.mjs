class P { constructor(x) { this.a = x; if (x === 2) throw new RangeError("two"); this.b = x; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
function run(n) { const out = []; for (let i = 0; i < n; i++) { try { const o = make(P, i); out.push(o.a + o.b); } catch (e) { out.push(e.message); } } return out.join(); }
console.log(run(Number("5")));
