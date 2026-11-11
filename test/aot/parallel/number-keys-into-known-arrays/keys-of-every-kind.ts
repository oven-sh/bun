// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
// A constant table of numbers, read in a loop under keys that may be fractions, missing, negative or no numbers.
const VALUES: readonly number[] = [0, 100, 320, 330, 500, 900, 20000];
class Board {
  readonly cells: number[] = new Array<number>(64).fill(0);
  score(): string {
    let total = 0;
    let missing = 0;
    for (let square = 0; square < this.cells.length; square++) {
      const piece = this.cells[square]!;
      if (piece === 0) continue;
      const type = Math.abs(piece);
      const value = VALUES[type];
      if (value === undefined) missing++;
      else total += piece > 0 ? value : -value;
    }
    return total + " " + missing;
  }
}
const pieces: unknown[] = [1, -2, 6, 6.5, -0, NaN, 7, -7, 1e10, -Infinity, 2 ** 31, 2 ** 32, "3", "x", null, undefined, true, [4], { valueOf: () => 5 }];
let lines = "";
for (const piece of pieces) {
  const board = new Board();
  for (let i = 0; i < 64; i += 3) board.cells[i] = (i % 13) - 6;
  lines += board.score() + "|";
  board.cells[20] = piece as number;
  lines += board.score() + "|";
  board.cells[0] = piece as number;
  board.cells[63] = piece as number;
  lines += board.score() + "\n";
}
console.log(lines);
