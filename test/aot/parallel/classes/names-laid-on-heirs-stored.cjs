class Shape { constructor(n) { this.n = n; } m(z) { return z; } own() { return 1; } }
class Square extends Shape { own() { return 2; } }
Square.prototype.m = function () { return 4; };
Square.prototype.own = function () { return 5; };
function walked(o) { const out = []; for (const q in o) out.push(q, typeof o[q]); return out.join(); }
function calls(o) { let sum = 0; for (const q in o) { const v = o[q]; sum = sum * 10 + (typeof v === "function" ? v.call(o) : v); } return sum; }
console.log("stored", walked(new Square(1)), walked(new Shape(2)), calls(new Square(6)));
