// makes an instance of a class, outside loops
const operations = 2;
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
let kept: Point = new Point(0, 0);
let total = 0;

kernel: {
  kept = new Point(total, 1);
  total += kept.y;
  kept = new Point(total, 2);
  total += kept.y;
}

console.log(total);
