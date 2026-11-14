const n = (value: number) => Number(process.argv[8] ?? value);
let ticks = 0;
let latest: any = 0;
function run(list: number[], cols: number, mark: any): number {
  let same = -1;
  for (let r = 0; r < list.length; r++) {
    ticks++;
    latest = r;
    for (let c = 0; c < cols; c++) {
      if (latest === mark) same = c;
      latest = c < 3 ? c : mark;
    }
  }
  return same;
}
console.log(run(JSON.parse("[1,1,1,1,1,1]"), n(8), JSON.parse('"x"')), ticks, latest);
