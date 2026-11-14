function F0(a) { this.a = a; }
F0.prototype.run = function () { return "r" + this.a; };
class F1 extends F0 {}
const o1 = new F1(2);
function use(o) { let t = 0; for (let i = 0; i < 4; i++) { const v = o.run; if (v) t += v.zzz === undefined ? 1 : 2; else t += 10; } return t; }
F1.prototype.run = 0;
console.log(use(o1)); F1.prototype.run = 7.5; console.log(use(o1)); F1.prototype.run = "s"; console.log(use(o1), o1.run.length);
