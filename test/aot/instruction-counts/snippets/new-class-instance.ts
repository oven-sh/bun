// makes an instance of a class and keeps it
class Point {
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}
}
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push(new Point(0, 0, 0));
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i] = new Point(i, i, i);
  total += points[7].y;
}

console.log(total);
