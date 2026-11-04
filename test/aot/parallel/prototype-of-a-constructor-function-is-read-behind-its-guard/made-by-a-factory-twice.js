const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function make(k) { function F(x) { this.x = x; } F.prototype.m = function () { return this.x + k; }; return F; }
const A = make(1), B = make(100);
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new A(i).m() + new B(i).m(); return t; }
console.log(attempt(() => run(6)));
