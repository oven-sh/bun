// Another function creates the keys of an empty literal.
interface Point {
  x: number;
  y: number;
}
function fill(point: Point) {
  point.y = 1;
  point.x = 2;
}
function make(): Point {
  const point = {} as Point;
  fill(point);
  return point;
}
console.log(Object.keys(make()).join());
