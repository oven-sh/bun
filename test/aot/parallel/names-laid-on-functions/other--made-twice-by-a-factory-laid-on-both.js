function make() { return function K(v) { this.v = v; }; }
const A = make(), B = make();
A.of = function (v) { return new A(v + 1); };
B.of = function (v) { return new B(v + 100); };
function read(n) { let t = 0; for (let i = 0; i < n; i++) t += (i & 1 ? A : B).of(i).v; return t; }
console.log(read(6));
