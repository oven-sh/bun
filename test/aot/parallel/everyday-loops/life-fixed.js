// Cells of four by four that live by their neighbors, for three turns
function life(cells) {
  const counts = [];
  for (let turn = 0; turn < 3; turn++) {
    const next = [];
    for (let i = 0; i < 16; i++) {
      let n = 0;
      for (let k = 0; k < 9; k++) {
        const x = (i & 3) + (k % 3) - 1, y = (i >> 2) + ((k / 3) | 0) - 1;
        if (k !== 4 && x >= 0 && x < 4 && y >= 0 && y < 4) n += cells[y * 4 + x];
      }
      next.push(n === 3 || (n === 2 && cells[i] === 1) ? 1 : 0);
      counts.push(n);
    }
    cells = next;
    counts.push(next.length);
  }
  return cells.join("") + " " + counts.length + " " + counts.reduce((a, b) => a + b, 0);
}
console.log(life([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
console.log(life([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]));
console.log(life(new Array(16).fill(1)));
