// A constructor fills a field although its prototype holds a plain value under the name.
// STATISTIC: AccessesProven >= 7
function Vector(x, y) {
  this.x = x;
  this.y = y;
}
Vector.prototype = { x: 0.5, y: 0, sum: function () { return this.x + this.y; } };
function Point(x) {
  this.x = x;
}
Point.prototype.x = null;
const kept = [];
function run(count) {
  let sum = 0;
  for (let index = 0; index < count; index++) {
    const vector = new Vector(index + 0.5, 2.25);
    const point = new Point(vector.sum());
    kept[index & 7] = vector;
    sum += point.x + vector.x;
  }
  return sum;
}
console.log(run(1000), Object.keys(kept[0]).join(), Vector.prototype.x, Point.prototype.x);
delete kept[1].x;
console.log(kept[1].x, kept[1].sum());
