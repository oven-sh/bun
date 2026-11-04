const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
const early = Object.create(F.prototype); console.log(typeof early.m); F.prototype.m = first; console.log(typeof early.m, new F(1).m());
