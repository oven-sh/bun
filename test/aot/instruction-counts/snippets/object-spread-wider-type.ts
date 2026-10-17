// copies objects with and without an optional field, turn by turn, into a type with one more field
type Point = { x: number; y: number; label?: string };
type Weighted = { x: number; y: number; label?: string; weight: number };
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push(i & 1 ? { x: i, y: i * 2, label: "l" } : { x: i, y: i * 2 });
const weighted: Weighted[] = [];
for (let i = 0; i < operations; i++) weighted.push({ x: 0, y: 0, weight: 0 });
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) weighted[i] = { ...points[i], weight: i };
  total += weighted[7].weight;
}

console.log(total, Object.keys(weighted[6]).join(), Object.keys(weighted[7]).join());
