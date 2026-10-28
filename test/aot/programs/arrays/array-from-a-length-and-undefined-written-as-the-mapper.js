const grid = Array.from({ length: 2 }, () => Array.from({ length: 2 }, undefined));
let count = 0;
for (const row of grid) for (const cell of row) count += cell === undefined ? 1 : 100;
console.log(JSON.stringify(grid), count, 1 in grid[0]);
for (const mapper of [null, 1, "f", {}]) {
  try {
    Array.from({ length: 1 }, mapper);
    console.log("made");
  } catch (error) {
    console.log(error.name);
  }
}
