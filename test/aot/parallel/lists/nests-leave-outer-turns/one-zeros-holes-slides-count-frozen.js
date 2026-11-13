const seen = [];
class Board {
  constructor(cells) { this.cells = cells; this.n = 0; }
  walk(square, steps) {
    let total = 0, turns = 0;
    for (const step of steps) { this.n++; for (let at = square + step; !(at & 0x88) && at < 60 && turns++ < 400; at += step) { const piece = this.cells[at]; if (piece === 0) continue; if (piece === 3) return 'hit ' + at; break; }  }
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
for (const square of [4, 11, 39, -3]) run(new Array(40).fill(0), square);
for (const square of [5, 12, 0.5, 2147483640]) { const cells = new Array(40).fill(0); Object.freeze(cells); run(cells, square); }
