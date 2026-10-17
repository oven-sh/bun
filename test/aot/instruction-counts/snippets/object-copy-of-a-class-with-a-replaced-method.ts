// copies an instance of a class, one of whose methods is replaced, with Object.assign(Object.create(Object.getPrototypeOf(x)), x)
class Point {
  x: number;
  y: number;
  z: number;
  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  copy(): Point {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
  describe(): string {
    return `${this.x}`;
  }
}
Point.prototype.describe = function (this: Point): string {
  return `${this.y}`;
};
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push(new Point(i, i * 2, i * 3));
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i] = points[i].copy();
  total += points[7].y;
}

console.log(total);
