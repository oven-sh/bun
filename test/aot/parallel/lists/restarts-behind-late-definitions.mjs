// A list of the file is made at its first use, in an iteration that then runs again as written: the second run finds it.
//
// Under: --aot-testing=CheckEffectsAtRunTime: an iteration that runs again has done nothing that is seen
function show(v) { return String(v); }
function attempt(n, f) { let r; try { r = show(f()); } catch (e) { } return r; }
class Sub extends Array { get '-1'() { } }
let c = 0; const M2 = [];
function f2(xs, k, n) { let s = 0; const l = []; for (let i = 0; i < 4; i++) { try { s += 1 + (M2[NaN] ?? 2); s += xs[i] === xs[xs.length] ? 1 : 5; if (i === 2) Object.defineProperty(M2, -1, { get() { }, configurable: true }); } catch (e) { } } return s; }
console.log(attempt('2.0', () => { const xs = new Sub(3); let z; try { z = f2(xs, 0, 0.5); } catch (e) { } return z; }), c);
console.log(attempt('2.1', () => { const xs = new Float64Array([1, 2, 3]); let z; try { z = f2(xs, 1, 3); } catch (e) { } return z; }), c);
