// stringify and parse of a list of records, once; and of each record.
// Sizes: 250 1000 4000
// Passes: 120
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Row = { id: number; name: string; tags: string[] };
function again(row: Row): number {
  return (JSON.parse(JSON.stringify(row)) as Row).tags.length;
}
function once(): string {
  const rows: Row[] = [];
  for (let i = 0; i < size; i++) rows.push({ id: i, name: "n" + (i & 63), tags: ["a", "b" + (i & 3)] });
  const text = JSON.stringify(rows),
    back: Row[] = JSON.parse(text);
  let sum = 0;
  for (const row of back) sum += again(row);
  return [text.length, back.length, sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
