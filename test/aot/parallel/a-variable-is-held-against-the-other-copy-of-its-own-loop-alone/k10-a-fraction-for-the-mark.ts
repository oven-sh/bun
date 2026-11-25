const n = (value: number) => Number(process.argv[8] ?? value);
let ticks = 0;
let latest: any = 0;
function run(rows: number, cols: number, mark: any): number {
  let same = -1;
  for (let r = 0; r < rows; r++) {
    ticks++;
    latest = r;
    for (let c = 0; c < cols; c++) {
      if (latest === mark) same = c;
      latest = c < 3 ? c : mark;
    }
  }
  return same;
}
console.log(run(n(6), n(8), JSON.parse("0.5")), ticks, latest);
