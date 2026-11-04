const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
console.log(`${{ toString() { return typeof new F(1).m; } }}`); F.prototype.m = first; console.log(typeof new F(1).m);
