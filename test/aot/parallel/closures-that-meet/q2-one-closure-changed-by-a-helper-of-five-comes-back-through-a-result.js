function id(e) { return e; }
function spoil(e) { var p = e.prototype; p.m = 1; Object.defineProperty(e, "prototype", { writable: false }); Object.getOwnPropertyNames(e); }
function A() {} function B() {} function C() {} function D() {} function E() {}
spoil(A); spoil(B); spoil(C); spoil(D); spoil(E);
var a = id(A), b = id(A);
console.log(typeof a, a === A, b === a, a.prototype.m);
