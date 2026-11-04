const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
F.prototype.toString = function () { return "x" + this.x; }; console.log(String(new F(1)), `${new F(2)}`, new F(3).toString());
