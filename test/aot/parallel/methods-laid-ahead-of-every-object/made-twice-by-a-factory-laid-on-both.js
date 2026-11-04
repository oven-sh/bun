const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function make() { return function F(x) { this.x = x; }; }
const A = make(), B = make();
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = i & 1 ? new A(i & 7) : new B(i & 7); t += o.m() + o.x; } return t; }
A.prototype.m = first; B.prototype.m = other; console.log(attempt(() => read(6)));
