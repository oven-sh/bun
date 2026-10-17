// copies an object that was given one property its type does not have, with a spread
type Point = { x: number; y: number; z: number };
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) {
  const point: Point = { x: i, y: i * 2, z: i * 3 };
  (point as any).mark = i;
  points.push(point);
}
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i] = { ...points[i] };
  total += points[7].y;
}

console.log(total);
