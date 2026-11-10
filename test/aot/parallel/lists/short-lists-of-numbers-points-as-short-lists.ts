type Point = readonly [number, number, number];
const points: Point[] = []; for (let i = 0; i < 16; i++) points.push([i + 0.5, i / 3, 2.5]);
function squared(a: Point, b: Point): number { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }
let sum = 0;
for (let turn = 0; turn < 2000; turn++) for (let i = 0; i < 16; i++) sum += squared(points[i]!, points[(i + turn) & 15]!);
console.log(Math.round(sum));
