// Counters of numbers and of an enum-like union in nested loops
type Kind = "low" | "middle" | "high";
function classify(grid: number[][]): Record<Kind, number> & { order: Kind[] } {
  const out = { low: 0, middle: 0, high: 0, order: [] as Kind[] };
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const kind: Kind = grid[y][x] < 1 ? "low" : grid[y][x] < 2 ? "middle" : "high";
      out[kind]++;
      if (out[kind] === 1) out.order.push(kind);
    }
    out.order.push("middle");
  }
  return out;
}
console.log(JSON.stringify(classify([[0, 1, 2], [0.5, 1.5, 2.5]])));
console.log(JSON.stringify(classify([[NaN, -0, Infinity]])));
console.log(JSON.stringify(classify([])), JSON.stringify(classify([[], [1]])));
