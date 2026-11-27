class Curve { constructor(n) { this.n = n; } m(z) { return z; } own() { return 1; } }
class Arc extends Curve { }
for (const k of ["m", "own"]) Arc.prototype[k] = () => 3;
function sum(o) { let total = 0; for (const q in o) { const v = o[q]; total = total * 10 + (typeof v === "function" ? v.call(o) : v); } return total; }
console.log("listed", sum(new Arc(1)), sum(new Curve(2)));
