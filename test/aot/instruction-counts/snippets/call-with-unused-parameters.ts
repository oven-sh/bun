// calls a non-inlined function with two unused parameters
type Point = { x: number; y: number };
let isNeverNegative = 0;
if (process.argv.length > 50) isNeverNegative = 1;
function xOf(scale: number, point: Point, label: string): number {
  try {
    if (isNeverNegative > 0) throw isNeverNegative;
  } catch {
    return 0;
  }
  return point.x;
}
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push({ x: i, y: -i });
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += xOf(i * 0.5, points[i], "point");
  total += sum;
}

console.log(total);
