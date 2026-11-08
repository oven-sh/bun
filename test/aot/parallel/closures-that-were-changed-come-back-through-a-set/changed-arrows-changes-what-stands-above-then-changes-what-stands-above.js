function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function mk(e) { Object.setPrototypeOf(e, Object.create(Function.prototype)); { Object.setPrototypeOf(e, Object.create(Function.prototype)); } return e; }
function run(step, n) { var t = 0; for (var i = 0; i < n; i++) t += step(i); return t; }
var A = i => i + 1, B = i => i * 2;
var a = mk(A), b = mk(B);
console.log(typeof a, typeof b, a === A, b === B, a === b, tell(function () { return run(a, 5); }), tell(function () { return run(b, 5); }), tell(function () { return a.name + a.length + b.name + b.length; }), tell(function () { return Object.keys(a).join() + Object.getOwnPropertySymbols(b).length; }), tell(function () { return typeof a.prototype + typeof b.prototype; }), Object.isFrozen(a), Object.isExtensible(b), tell(function () { return a.call(null, 2) + b.apply(null, [2]); }), a instanceof Function);
