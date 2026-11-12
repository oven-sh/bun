function point(x, y) {
  return { x, y };
}
function added(a, b) {
  return point(a.x + b.x, a.y + b.y);
}
const sum = added(point(1, 2), point(3, 4));
console.log(sum.x, sum.y, JSON.stringify(sum));
