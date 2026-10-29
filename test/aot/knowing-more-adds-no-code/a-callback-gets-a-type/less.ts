
type Row = { key: string; count: number };
function each(rows: Row[], visit: any): void {
  for (let i = 0; i < rows.length; i++) visit(rows[i], i);
}
let text = "";
const rows: Row[] = [{ key: "a", count: 1 }, { key: "b", count: Number(process.argv[2] ?? 2) }];
each(rows, (row: Row, i: number) => { text += row.key + row.count * i; });
each(rows, (row: Row) => { text += row.key.toUpperCase(); });
console.log(text);
