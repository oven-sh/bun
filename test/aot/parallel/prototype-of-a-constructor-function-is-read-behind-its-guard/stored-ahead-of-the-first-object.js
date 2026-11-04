const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
F.prototype = { m() { return this.x + 100; } };
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new F(i).m(); return t; }
console.log(attempt(() => run(6)));
