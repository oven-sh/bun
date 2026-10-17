// copies objects with and without an optional field, turn by turn, behind the one field more that the literal's type has
type Point = { x: number; y: number; label?: string };
type Weighted = { weight: number; x: number; y: number; label?: string };
const operations = 100;
const points: Point[] = [];
for (let i = 0; i < operations; i++) points.push(i & 1 ? { x: i, y: i * 2, label: "l" } : { x: i, y: i * 2 });
const weighted: Weighted[] = [];
for (let i = 0; i < operations; i++) weighted.push({ weight: 0, x: 0, y: 0 });
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) weighted[i] = { weight: i, ...points[i] };
  total += weighted[7].weight;
}

console.log(total, Object.keys(weighted[6]).join(), Object.keys(weighted[7]).join());
