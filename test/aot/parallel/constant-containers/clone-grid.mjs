function fresh(n) { const grid = []; for (let i = 0; i < n; i++) grid.push([0, 0, 0]); return { grid, turn: 0 }; }
function play(n) {
  const next = structuredClone(fresh(n));
  next.grid[0][0] = 1;
  let marks = 0;
  for (let i = 0; i < n; i++) marks += next.grid[i][0] | 0;
  return marks;
}
console.log(play(3));
console.log(play(4));
