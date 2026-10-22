// A plain constructor function that somebody also CALLS, with an object of another kind as `this`. What `new` makes still has both fields from its birth on.
function Point(x, y) {
  this.x = x;
  this.y = y;
}
function sum(points) {
  let total = 0;
  for (const point of points) total += point.x + point.y;
  return total;
}
const points = [];
for (let i = 0; i < 4; i++) points.push(new Point(i, i * 2));
const other = { name: "other" };
[5, 6].forEach(Point, other);
console.log(sum(points), other.name, other.x, other.y);
const borrowed = Object.create(null);
Point.call(borrowed, 7, 8);
console.log(borrowed.x, borrowed.y, Object.keys(points[3]).join());
