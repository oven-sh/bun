const GRID = [
  [1, 2, 3],
  [4, 5, 6],
];
const transposed = GRID[0].map((_, c) => GRID.map((row) => row[c]));
const flat = GRID.flat();
console.log(transposed, flat.reduce((a, b) => a + b), Math.max(...flat), GRID.map((r) => r.join(" ")).join(" / "));
