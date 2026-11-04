// The collector runs between parses by a written type, and large texts make it run within them: what the run time has learned of the texts is dropped and learned anew, and nothing that was parsed is lost.
type Row = { id: number; name: string; tags: string[]; inner: { on: boolean; note: string } };
function load(text: string) { return JSON.parse(text) as Row[]; }
function rowText(i: number) { return `{"id":${i},"name":"name ${i} ${"x".repeat(i % 50)}","extra":"e${i}","tags":["a${i}","b${i}"],"inner":{"on":${i % 2 === 0},"note":"note ${i}","more":${i}}}`; }
function check(rows: Row[]) {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.id !== i || row.name.length !== `name ${i} `.length + i % 50 || row.tags[1] !== "b" + i || row.inner.on !== (i % 2 === 0) || row.inner.note !== "note " + i || (row as any).extra !== "e" + i || (row.inner as any).more !== i)
      return "wrong at " + i + ": " + JSON.stringify(row);
    sum += row.id;
  }
  return rows.length + " " + sum;
}
const kept: Row[][] = [];
for (let round = 0; round < 12; round++) {
  const parts: string[] = [];
  for (let i = 0; i < 3000; i++) parts.push(rowText(i));
  const rows = load("[" + parts.join(",") + "]");
  kept.push(rows);
  if (round % 3 === 0) Bun.gc(true);
  console.log(check(rows));
}
Bun.gc(true);
for (const rows of kept) console.log(check(rows));
