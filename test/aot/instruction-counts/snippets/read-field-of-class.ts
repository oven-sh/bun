// reads a field of a class instance
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
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].y;
  total += sum;
}

console.log(total);
