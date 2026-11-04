const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function make() { return function F(x) { this.x = x; }; }
const A = make(), B = make();
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new B(i & 7); t += o.m() + o.x; } return t; }
A.prototype.m = first; console.log(attempt(() => read(5)));
