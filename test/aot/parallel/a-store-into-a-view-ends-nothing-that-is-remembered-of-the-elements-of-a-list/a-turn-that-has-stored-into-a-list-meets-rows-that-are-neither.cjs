"use strict";
// The marks are a list of numbers; in late rounds no row is a list or a view.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function fill(grid, marks, tally, side, weight) {
  let sum = 0;
  for (let round = 1; round < side; round++) {
    for (let j = 0; j < round; j++) {
      marks[j] = marks[j] + 1;
      tally.turns++;
      grid[j][round] = weight + j;
      sum += grid[j][j] * weight + marks[j];
    }
  }
  return sum;
}
const said = [];
for (let turn = 0; turn < 6; turn++) {
  const grid = data.map((row, i) => turn > 2 ? Object.assign({ length: 6 }, row) : Float64Array.from(row)), marks = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], tally = { turns: 0 };
  said.push(fill(grid, marks, tally, 6, turn + 0.25) + ":" + Array.from(marks).join("+") + ":" + tally.turns);
}
console.log(said.join(" | "));
