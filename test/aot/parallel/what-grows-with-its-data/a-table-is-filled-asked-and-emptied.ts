// Map: set, get, has, delete.
// Sizes: 250 1000 4000
// Passes: 620
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function put(table: Map<number, number>, k: number): void {
  table.set(k, (table.get(k) ?? 0) + 1);
}
function once(): string {
  const table = new Map<number, number>();
  for (let i = 0; i < size * 4; i++) put(table, (i * 31) % (size * 2));
  let hits = 0;
  for (let i = 0; i < size * 4; i++) if (table.has(i)) hits++;
  for (let i = 0; i < size * 2; i += 2) table.delete(i);
  return [table.size, hits].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
