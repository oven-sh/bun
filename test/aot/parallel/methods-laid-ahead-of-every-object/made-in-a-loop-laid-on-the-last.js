const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
const all = [];
for (let k = 0; k < 3; k++) all.push(function F(x) { this.x = x; });
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new all[i % 3](i & 7); t += o.m() + o.x; } return t; }
all[2].prototype.m = first; console.log(attempt(() => read(6)));
