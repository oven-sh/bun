interface Point { readonly x: number; readonly y: number }
interface Named { name: string }
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function PointMaker(this: Mutable<Point>, x: number, y: number) {
  this.x = x;
  this.y = y;
}
function NamedPoint(this: Mutable<Point> & Named, x: number, name: string) {
  this.x = x;
  this.y = -x;
  this.name = name;
}
PointMaker.prototype.norm = function (this: Point): number { return Math.abs(this.x) + Math.abs(this.y); };

function sum(points: Point[]): number {
  let total = 0;
  for (const point of points) total += point.x * 10 + point.y;
  return total;
}

const points: Point[] = [];
for (let i = 0; i < 5; i++) points.push(new PointMaker(i, i + 1));
points.push({ x: 7, y: 8 });
const named = new NamedPoint(3, "three");
points.push(named);
console.log(sum(points), named.name, Object.keys(points[0]).join(), points[0] instanceof PointMaker, (points[1] as any).norm(), JSON.stringify(named));
