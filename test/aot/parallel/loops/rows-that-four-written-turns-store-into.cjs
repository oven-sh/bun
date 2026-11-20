// The row that all iterations of a short loop read and store into is checked once.
// STATISTIC: RowsGuardedForUnrolledLoops >= 4
"use strict";
function shift(board, y, by) {
  for (let x = 0; x < 4; x++) board[y][x] = (board[y][x] * 3 + by) & 255;
}
function turn(board, y) {
  for (let x = 0; x < 4; x++) board[y][x] ^= board[y][(x + 1) & 3] >> 1;
}
function both(board, one, two) {
  for (let x = 0; x < 4; x++) {
    const held = board[one][x];
    board[one][x] = board[two][x] + x;
    board[two][x] = held - x;
  }
}
function all(board, rounds) {
  for (let round = 0; round < rounds; round++) {
    for (let y = 0; y < 4; y++) shift(board, y, round + y);
    for (let y = 0; y < 4; y++) turn(board, y);
    both(board, round & 3, (round + 1) & 3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) board[y][x] = (board[y][x] + round) & 1023;
  }
  return board;
}
const text = board => board.map(row => (row ? Array.from(row, (one, at) => (at in row ? String(one) : "hole")).join(" ") : "none")).join(" / ");
const fresh = () => [0, 1, 2, 3].map(y => [0, 1, 2, 3].map(x => y * 40 + x * 7));
for (let round = 0; round < 30; round++) {
  const board = all(fresh(), 5 + (round % 4));
  if (round % 11 === 0) console.log(text(board));
}
