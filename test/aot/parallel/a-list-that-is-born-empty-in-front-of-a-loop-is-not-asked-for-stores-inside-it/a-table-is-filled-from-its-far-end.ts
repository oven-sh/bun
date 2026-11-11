// STATISTIC: ArraysGuardedUnderSpeculatedCounters = 0
const rounds = Number(process.argv[2] ?? 3);
const size = Number(process.argv[3] ?? 12);
function table(count: number, by: number): number[] {
  const cells: number[] = [];
  for (let i = count; i >= 0; --i) cells[i] = i * 0.5 + by;
  return cells;
}
function upward(from: number, count: number, by: number): number[] {
  const cells: number[] = [];
  for (let i = from; i < count; i++) cells[i] = i * 0.25 + by;
  return cells;
}
for (let r = 0; r < rounds; r++) {
  const down = table(size, 1 + (r & 3));
  console.log(down.length, down[0], down[3], down.join());
  const up = upward(r & 1, size, r & 3);
  console.log(up.length, up[1], Object.keys(up).length, up.join());
  console.log(table(-1, 2).length, table(0, 2).join(), table(1.5, 2).length, Object.keys(table(1.5, 2)).join());
}
