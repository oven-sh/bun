function mk(e) { var p = e.prototype; p.m = 1; return Object.defineProperty(e, "prototype", { writable: false }), e; }
var A = function () { function A() {} return mk(A); }();
var B = function () { function B() {} return mk(B); }();
console.log(typeof A, typeof B, A.prototype.m, B.prototype.m);
