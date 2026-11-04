const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
const all = [];
for (let k = 0; k < 3; k++) { const F = function (x) { this.x = x; }; F.prototype.m = function () { return this.x + k * 10; }; all.push(F); }
function run(n) { let t = 0; for (let i = 0; i < n; i++) for (const F of all) t += new F(i).m(); return t; }
console.log(attempt(() => run(6)));
