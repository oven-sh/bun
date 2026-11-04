class Point { constructor(x) { this.x = x; } norm() { return Math.abs(this.x); } }
function id(x) { return x; }
const got = [id(new Point(-3)), id({ x: 4 }), id({ y: 5 }), id(new Point(6))];
console.log(got.map(each => (each instanceof Point ? each.norm() : (each.x ?? -each.y))).join());
