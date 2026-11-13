// A template for each record.
// Sizes: 1000 4000 16000
// Passes: 210
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Row = { id: number; name: string; ok: boolean };
function show(row: Row): string {
  return `${row.id}: ${row.name} (${row.ok ? "yes" : "no"})`;
}
function once(): string {
  let total = 0;
  for (let i = 0; i < size * 4; i++) total += show({ id: i & 1023, name: "n" + (i & 63), ok: (i & 3) === 0 }).length;
  return [total].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
