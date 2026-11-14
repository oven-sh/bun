const seen = [];
class Board {
  constructor(cells) { this.cells = cells; this.n = 0; }
  walk(square, steps) {
    let total = 0, turns = 0;
    for (const step of steps) { seen.push(step); for (let at = square; at < 45 && turns++ < 300; at += step) total += this.cells[at].size | 0;  }
    return total + '/' + turns;
  }
}
const steps = [2147483647, 1, -2147483648];
function run(cells, square) {
  const board = new Board(cells);
  let said;
  try { said = board.walk(square, steps); } catch (e) { said = e.constructor.name; }
  console.log(square, said, board.n, seen.splice(0).join().slice(0, 100));
}
for (const square of [4, 11, 39, -3]) run(new Array(40).fill(0), square);
for (const square of [5, 12, 0.5, 2147483640]) { const cells = new Array(40).fill(0); Object.defineProperty(cells, 11, { get() { seen.push('get'); return 1; }, configurable: true }); run(cells, square); }
