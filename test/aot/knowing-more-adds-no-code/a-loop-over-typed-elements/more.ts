
type Cell = { v: number; w: number };
function sum(cells: Cell[]): number {
  let s = 0;
  for (let i = 0; i < cells.length; i++) { const c = cells[i]; s += c.v * c.w; }
  return s;
}
const table: Record<string, (cells: any) => number> = { sum };
const cells = JSON.parse(process.argv[2] ?? '[{"v":1,"w":2},{"v":3,"w":4}]');
console.log(table[process.argv[3] ?? "sum"](cells));
