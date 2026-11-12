function mk(e) { var p = e.prototype; p.m = 1; return Object.defineProperty(e, "prototype", { writable: false }), e; }
function A() {}
function B() {}
var a = mk(A), b = mk(B);
console.log(typeof a, typeof b, a.prototype.m, b.prototype.m, a === A, b === B);
