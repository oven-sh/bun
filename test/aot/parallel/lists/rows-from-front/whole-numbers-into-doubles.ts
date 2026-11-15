const N = 6, n = 32;
function table(f: (i: number, j: number) => number): number[][] { const t: number[][] = []; for (let i = 0; i < n; i++) { const row: number[] = []; for (let j = 0; j < n; j++) row.push(f(i, j)); t.push(row); } return t; }
const g = table((i, j) => ((i * 7 + j * 3) & 7) / 2), o = table(() => 0.5);
function run(g: number[][], o: number[][]): number { for (let i = 1; i < n; i++) for (let j = 0; j < n; j++) o[i]![j] = g[i]![j] === g[i - 1]![j] ? 1 : 2; return o[3]![3]!; }
let sum = 0; for (let t = 0; t < N; t++) sum += run(g, o);
console.log(sum, o[3]!.join());
const whole = table((i, j) => (i + j) & 3), halves = table((i, j) => (i + j) / 2), mixed = table((i, j) => j === 9 ? 0.5 : i);
for (const a of [g, whole, halves, mixed]) for (const b of [o, whole, halves, mixed, a]) console.log(run(a, b), b[7]!.join());
