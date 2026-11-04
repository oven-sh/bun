const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function make() { return function K(v) { this.v = v; }; }
const A = make(), B = make();
A.of = function (v) { return new A(v + 1); };
function read(n) { let t = 0; for (let i = 0; i < n; i++) t += B.of(i).v; return t; }
console.log(attempt(() => read(5)), A.of(1).v);
