function F0(a) { this.a = a; }
F0.prototype.run = function () { return "r" + this.a; };
class F1 extends F0 {}
const o1 = new F1(2);
function use(o) { let s = ""; for (let k = 0; k < 3; k++) { const v = o.run; s += typeof v; if (v) s += v.name; s += v ? "t" : "f"; s += v === 61; } console.log(s); }
F1.prototype.run = 61;
use(o1);
