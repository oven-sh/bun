const seen = [];
class Board {
  constructor(cells) { this.cells = cells; this.n = 0; }
  walk(square, steps) {
    let total = 0, turns = 0;
    for (const step of steps) { this.n++; for (let i = 0; i < 4; i++) for (let j = i; j < 6; j += 2) total += this.cells[i * 6 + j] * 2; for (let k = square; k < 30 && turns++ < 300; k += step) total -= this.cells[k];  }
    return total + '/' + turns;
  }
}
const steps = [2, , 4];
function run(cells, square) {
  const board = new Board(cells);
  let said;
  try { said = board.walk(square, steps); } catch (e) { said = e.constructor.name; }
  console.log(square, said, board.n, seen.splice(0).join().slice(0, 100));
}
for (const square of [4, 11, 39, -3]) run(Array.from({ length: 40 }, (_, i) => (i * 7) % 5), square);
for (const square of [5, 12, 0.5, 2147483640]) { const cells = Array.from({ length: 40 }, (_, i) => (i * 7) % 5); cells.note = 1; cells[-1] = 5; run(cells, square); }
