type Point = readonly [number, number, number];
const squared = (a: Point, b: Point): number => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
const blocks = (a: Point, b: Point): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const points: Point[] = []; for (let i = 0; i < 16; i++) points.push([i + 0.5, i / 3, 2.5]);
const odd = [[1, 2], "text", { 0: 4, 1: 5, 2: 6 }, new Float64Array([7.5, 8.5, 9.5]), [1, , 3], [NaN, -0, 1e308], null] as unknown as Point[];
let sum = 0;
for (const distance of [squared, blocks]) {
    for (let turn = 0; turn < 500; turn++) for (let i = 0; i < 16; i++) sum += distance(points[i]!, points[(i + turn) & 15]!);
    for (const other of odd) { try { console.log(distance(points[1]!, other), distance(other, points[2]!)); } catch (error) { console.log((error as Error).constructor.name); } }
}
console.log(Math.round(sum));
