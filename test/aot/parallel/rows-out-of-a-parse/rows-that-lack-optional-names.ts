// Rows out of a text that lack optional names, hold undefined, null or another kind under them, gain and lose them, and stand below a changed prototype.
// COUNTER: ObjectsParsedIntoRecords >= 400
interface Row { id: number; tag?: string; note?: string | null; meta?: { score: number; deep?: boolean } }
const texts: string[] = ['{"id":1}', '{"id":2,"tag":"a"}', '{"id":3,"note":null}', '{"id":4,"tag":"b","note":"n","meta":{"score":1}}', '{"id":5,"meta":{"score":2,"deep":true}}', '{"id":6,"tag":7}', '{"id":"7"}', '{"tag":"c","id":8}', '{"id":9,"extra":1}', '{"id":10,"meta":null}'];
const out: string[] = [], show = (v: unknown): string => typeof v + String(v);
function look(r: Row): string { return [show(r.tag?.length ?? 0), r.tag ? "t" : "f", r.tag === undefined, "tag" in r, Object.hasOwn(r, "tag"), show(r.note), show(r.meta?.score), show(r.meta?.deep), Object.keys(r).join("."), JSON.stringify(r)].join(); }
function sum(rows: Row[]): string { let s = 0, m = 0; for (const r of rows) { s += r.id; if (r.tag === undefined) m++; if (r.note === null) m += 10; m += r.meta?.score ?? 100; } return s + "/" + m; }
for (let turn = 0; turn < 40; turn++) {
  out.length = 0; const rows: Row[] = JSON.parse("[" + texts.join() + "]"); out.push(sum(rows)); for (const r of rows) out.push(look(r));
  rows[0]!.tag = "late"; delete rows[1]!.tag; rows[2]!.note = undefined; (rows[4] as any).tag = 5; Object.freeze(rows[8]); out.push(sum(rows)); for (const r of rows) out.push(look(r), look({ ...r, tag: "s" }), look({ ...r }));
  const own: Row = { id: 11 }; out.push(look(own), sum([own, ...rows])); const below: Row = Object.create(rows[3]!); out.push(look(below)); Object.setPrototypeOf(rows[0]!, { note: "above" }); delete rows[0]!.tag; out.push(look(rows[0]!), sum(rows));
}
console.log(out.join("|")); export {};
