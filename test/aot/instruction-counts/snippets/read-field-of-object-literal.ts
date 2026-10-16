// reads a field of an object literal
type Point = { x: number; y: number; z: number };
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push({ x: i, y: i * 2, z: i * 3 });
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].y;
  total += sum;
}

console.log(total);
