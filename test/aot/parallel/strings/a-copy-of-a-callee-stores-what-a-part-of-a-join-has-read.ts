interface Row { id: number; on: boolean; hits: number } const log: string[] = [];
const unseen = <V,>(value: V): V => [value][JSON.parse("0")] as V;
function touch(row: Row): number { row.id = (row.id + 1) | 0; row.hits = (row.hits + 1) | 0; return row.hits; }
function render(rows: Row[], turns: number): string { let last = "", total = 0;
  for (let i = 0; i < turns; i++) { const row = rows[i & 3]!; const head = row.id + ":" + row.on; const hits = touch(row); const text = head + "/" + hits + "/" + row.id;
    total = (total + text.length) | 0; last = text; }
  return last + "#" + total; }
const rows: Row[] = [10, 20, 30, 40].map((id, at) => ({ id, on: (at & 1) === 1, hits: 0 })); console.log(render(rows, 240));
const odd = { get id() { log.push("get"); return 7; }, set id(v: number) { log.push("set" + v); }, on: false, hits: 0 };
console.log(render(unseen([{ on: true, id: 1, hits: 0 }, odd, rows[0]!, { id: 2.5, on: true, hits: 0 }]), 4), log.join());
