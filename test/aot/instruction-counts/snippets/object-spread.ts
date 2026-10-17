// copies an object with a spread and changes one field
type Point = { x: number; y: number; z: number };
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push({ x: i, y: i * 2, z: i * 3 });
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i] = { ...points[i], y: i };
  total += points[7].y;
}

console.log(total);
