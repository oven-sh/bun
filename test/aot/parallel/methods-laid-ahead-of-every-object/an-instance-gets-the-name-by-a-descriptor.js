const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
function tag(o) { Object.defineProperty(o, "m", { value: other }); return o; }
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = i & 1 ? tag(new F(i & 7)) : new F(i & 7); t += o.m() + o.x; } return t; }
F.prototype.m = first; console.log(attempt(() => read(6)));
