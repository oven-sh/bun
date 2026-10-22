function report(x) { try { return Reflect.defineProperty(x, "k", { get() {} }); } catch (e) { return "threw"; } }
function make() {}
const o = make;
console.log(report(o), report(o));
const p = {};
console.log(report(p), report(p));
function define(x) { try { Object.defineProperty(x, "j", { get() { return 1; } }); return "defined"; } catch (e) { return "threw " + e.name; } }
console.log(define(p), define(p));
function value(x) { return Reflect.defineProperty(x, "f", { value() {} }); }
console.log(value(p), value(p));
function fresh() { return () => {}; }
console.log(fresh() === fresh(), new Set([fresh(), fresh(), fresh()]).size);
const seen = new WeakSet(); function once() { const f = function () {}; const had = seen.has(f); seen.add(f); return had; }
console.log(once(), once());
