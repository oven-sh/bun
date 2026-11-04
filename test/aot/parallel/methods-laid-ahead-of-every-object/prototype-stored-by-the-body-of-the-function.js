const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; if (++turn === 3) F.prototype = 5; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
let turn = 0;
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new F(i & 7); t += o.m() + o.x; } return t; }
F.prototype.m = first; console.log(attempt(() => read(5)));
