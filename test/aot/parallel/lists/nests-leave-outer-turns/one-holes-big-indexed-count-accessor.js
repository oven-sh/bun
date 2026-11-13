const seen = [];
class Board {
  constructor(cells) { this.cells = cells; this.n = 0; }
  walk(square, steps) {
    let total = 0, turns = 0;
    for (let s = 0; s < steps.length; s++) { const step = steps[s]; this.n++; for (let at = square + step; at >= 0 && at < 60 && turns++ < 400; at += step) { total += this.cells[at]; }  }
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
for (const square of [4, 11, 39, -3]) run((() => { const l = new Array(40).fill(0); delete l[9]; l[20] = 3; return l; })(), square);
for (const square of [5, 12, 0.5, 2147483640]) { const cells = (() => { const l = new Array(40).fill(0); delete l[9]; l[20] = 3; return l; })(); Object.defineProperty(cells, 11, { get() { seen.push('get'); return 1; }, configurable: true }); run(cells, square); }
