function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
const Bound = Point.bind(null, 10);
function run(n) { let t = 0; for (let i = 0; i < n; i++) { if (i === 2) Point.prototype = { sum() { return -1; } }; t += new Bound(i).sum(); } return t; }
console.log(run(4));
