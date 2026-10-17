// makes an object literal and keeps it
type Point = { x: number; y: number; z: number };
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push({ x: 0, y: 0, z: 0 });
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i] = { x: i, y: i, z: i };
  total += points[7].y;
}

console.log(total);
