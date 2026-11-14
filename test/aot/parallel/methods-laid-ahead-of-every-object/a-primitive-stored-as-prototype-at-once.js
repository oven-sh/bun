const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new F(i & 7); t += o.m() + o.x; } return t; }
F.prototype.m = first; F.prototype = 5; console.log(attempt(() => read(5)));
