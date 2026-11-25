const n = (value: number) => Number(process.argv[8] ?? value);
let ticks = 0;
let latest: any = 0;
function run(rows: number, cells: number[], mark: any): number {
  for (let r = 0; r < rows; r++) {
    ticks++;
    latest = r;
    for (const cell of cells) { latest++; if (cell === 3) latest = mark; }
  }
  return rows;
}
console.log(run(n(6), JSON.parse("[1,2,3,4]"), JSON.parse('"x"')), ticks, latest);
