class Queue {
  reads = 0; items: any[];
  constructor(items: any[]) { this.items = items; }
  get length(): number { this.reads++; return this.items.length; }
}
function drain(rows: any[]): string {
  const out: string[] = [];
  for (const row of rows) {
    const q = new Queue(row);
    let n = 0;
    for (let i = 0; i < q.length; i++) n += row[i];
    out.push(n + "/" + q.reads);
  }
  return out.join(" ");
}
const rows = JSON.parse("[[1,2,3],[4,5],[6]]");
let said = "";
for (let turn = 0; turn < 300; turn++) said = drain(rows);
console.log(said);
