class Stroke { constructor(n) { this.n = n; } m(z) { return z; } }
class Line extends Stroke { }
const lines = Line.prototype;
lines.m = () => 8;
class Short extends Line { w = 3; }
function finds(o, value) { for (const q in o) if (o[q] === value) return q; return "none"; }
function sum(o) { let total = 0; for (const q in o) { const v = o[q]; total = total * 10 + (typeof v === "function" ? v.call(o) : v); } return total; }
console.log("named", finds(new Line(1), undefined), finds(new Short(2), 3), sum(new Line(2)), sum(new Short(3)));
