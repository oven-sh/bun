// Each record is written as JSON and joined to one text, and the whole list is written once.
// Sizes: 1000 4000 16000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Row = { id: number; name: string; tags: string[]; ok: boolean };
function once(): string {
  const rows: Row[] = [];
  for (let i = 0; i < size; i++) rows.push({ id: i, name: "n" + (i & 63), tags: ["a", "b" + (i & 3)], ok: (i & 1) === 0 });
  let out = "";
  for (const row of rows) out += JSON.stringify(row) + "\n";
  const whole = JSON.stringify(rows);
  return out.length + " " + whole.length;
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
