class Ring { constructor(n) { this.n = n; } m(z) { return z; } own() { return 1; } }
class Circle extends Ring { }
Object.assign(Circle.prototype, { m() { return 6; }, own() { return 7; } });
function same(a, b) { for (const q in a) if (a[q] !== b[q]) return "not " + q; return "same"; }
function plain(from) { const to = {}; for (const q in from) to[q] = from[q]; return to; }
console.log("assigned", Object.keys(plain(new Circle(1))).join(), same(new Circle(1), new Circle(1)), same(new Circle(1), new Circle(2)));
