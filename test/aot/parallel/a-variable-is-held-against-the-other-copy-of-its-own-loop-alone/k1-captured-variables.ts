const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let ticks = 0; let latest: any = 0;
  return { run(rows: number, cols: number, mark: any): number { let same = -1; for (let r = 0; r < rows; r++) { ticks++; latest = r; for (let c = 0; c < cols; c++) { if (latest === mark) same = c; latest = c < 3 ? c : mark; } } return same; }, get: () => ticks + " " + latest }; }
const made = make();
console.log(made.run(n(6), n(8), JSON.parse('"x"')), made.get());
