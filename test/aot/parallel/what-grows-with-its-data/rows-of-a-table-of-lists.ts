// A list of short lists.
// Sizes: 250 1000 4000
// Passes: 260
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function sumOf(row: number[]): number {
  let s = 0;
  for (let k = 0; k < row.length; k++) s += row[k]!;
  return s;
}
function once(): string {
  const rows: number[][] = [];
  for (let i = 0; i < size * 3; i++) rows.push([i & 7, i & 15, i & 31, 1]);
  let sum = 0;
  for (const row of rows) sum += sumOf(row);
  return [sum, rows.flat().length, rows.flatMap(row => row.slice(0, 2)).length].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
