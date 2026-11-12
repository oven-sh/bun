// `{ id, label, ...(flag ? { seen: true } : report(it.meta)) }` in a loop: what the copy is expected to bring is the literal's own type; what report() gives, once it is walked in place, is another record or nothing:
// the test for the expected layout can never pass: that way ends, and the copy stands as written on the other.
type Row = { id: number; label: string; seen?: boolean; extra?: number; note?: string };
function report(meta: any): { extra: number; note: string } | undefined { if (!meta) return undefined; return { extra: meta.n, note: "n" + meta.n }; }
function show(o: any): string { return Object.keys(o).map(k => k + "=" + o[k]).join(","); }
function collect(list: any[], flag: boolean): Row[] {
  const out: Row[] = [];
  for (const it of list) out.push({ id: it.id, label: it.label, ...(it.seen && { seen: true }), ...(flag ? { seen: false } : report(it.meta)) });
  return out;
}
async function collectLater(list: any[], flag: boolean): Promise<Row[]> {
  const out: Row[] = [];
  for (const it of list) { await null; out.push({ id: it.id, label: it.label, ...(it.seen && { seen: true }), ...(flag ? { seen: false } : report(it.meta)) }); }
  return out;
}
const list: any[] = JSON.parse('[{"id":1,"label":"a","meta":{"n":5}},{"id":2,"label":"b","seen":true},{"id":3,"label":"c","seen":true,"meta":{"n":6}}]');
console.log(collect(list, false).map(show).join(" | "));
console.log(collect(list, true).map(show).join(" | "));
collectLater(list, false).then(rows => { console.log(rows.map(show).join(" | ")); return collectLater(list, true); }).then(rows => console.log(rows.map(show).join(" | ")));
