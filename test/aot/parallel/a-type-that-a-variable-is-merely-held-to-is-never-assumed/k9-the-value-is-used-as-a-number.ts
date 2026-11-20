const n = (value: number) => Number(process.argv[8] ?? value);
function make() {
  let ticks = 0;
  let latest: any = 0;
  return {
    run(rows: number, mark: any): number {
      let same = -1;
      latest = rows;
      for (let r = 0; r < rows; r++) {
        ticks++;
        if (latest === mark) same = r; else same = (same + (latest as number) * 0) | 0;
        latest = r < 3 ? r : mark;
      }
      return same;
    },
    get: () => ticks + " " + latest,
  };
}
const m = make();
console.log(m.run(n(8), JSON.parse('"x"')), m.get());
