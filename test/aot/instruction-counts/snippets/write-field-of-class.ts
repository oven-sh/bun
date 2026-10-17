// writes a field of a class instance
class Point {
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}
}
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push(new Point(i, i * 2, i * 3));
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i].y = i;
  total += points[7].y;
}

console.log(total);
