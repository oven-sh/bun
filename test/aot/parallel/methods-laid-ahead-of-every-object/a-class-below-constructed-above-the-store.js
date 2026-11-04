const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
class B extends F { } console.log(typeof new B(1).m); F.prototype.m = first; console.log(typeof new B(1).m);
