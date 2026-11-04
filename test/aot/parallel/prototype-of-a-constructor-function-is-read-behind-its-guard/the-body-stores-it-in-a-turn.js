const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
const second = { m() { return this.x + 100; } };
let turn = 0;
function F(x) { this.x = x; if (++turn === 3) F.prototype = second; }
F.prototype.m = function () { return this.x + 1; };
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new F(i).m(); return t; }
console.log(attempt(() => run(6)));
