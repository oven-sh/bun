// Flags: --aot-testing=FailPredictions:2:1
class Point {
  constructor(
    public x: number,
    public y: number,
    public label?: string,
  ) {}
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
}
function total(points: Point[]): number {
  let sum = 0;
  for (const point of points) sum += point.norm();
  return sum;
}
function describePoint(point: Point, digits: number): string {
  return (point.label ?? "-") + point.x.toFixed(digits) + "," + point.y.toFixed(digits);
}
function untyped(value: any, times: number) {
  let out = value;
  for (let turn = 0; turn < times; turn++) out = out + value;
  return out;
}
const points: Point[] = [];
for (let index = 0; index < 300; index++) points.push(new Point(index, index + 1, index % 3 ? undefined : "p" + index));
const byLabel = new Map<string, Point>();
for (const point of points) if (point.label) byLabel.set(point.label, point);
console.log(total(points).toFixed(3), byLabel.size, describePoint(points[3], 1), describePoint(points[4], 2));
console.log(untyped(1, 5), untyped("a", 3), [...points.slice(0, 2)].map(point => JSON.stringify(point)).join());
const { x, ...rest } = points[6];
console.log(
  x,
  Object.keys(rest).join(),
  points
    .filter(point => point.x % 100 === 0)
    .map(point => point.y)
    .join(),
);
async function later(value: number): Promise<number> {
  await null;
  return value * 2;
}
console.log((await Promise.all([1, 2, 3].map(later))).join());
