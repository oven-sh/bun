// The same two fields stored late in both orders
function Point(x) {
  this.x = x;
}
function fill(x, flip) {
  const point = new Point(x);
  if (flip) {
    point.z = x * 3;
    point.y = x * 2;
  } else {
    point.y = x * 2;
    point.z = x * 3;
  }
  return JSON.stringify(point) + (point.y + point.z);
}
console.log(fill(1, false), fill(1, true));
console.log(fill(5, true), fill(6, true));
console.log(fill(-2, false), fill(0, true));
