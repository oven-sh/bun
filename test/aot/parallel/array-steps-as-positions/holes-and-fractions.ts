// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
// Holes among the steps, and squares that are no whole numbers.
class Board {
  readonly cells: number[] = new Array<number>(128).fill(0);
  constructor() {
    for (let i = 0; i < 128; i += 3) this.cells[i] = (i % 7) - 3;
  }
  count(square: number, steps: number[], want: number): string {
    let found = 0;
    let seen = 0;
    let total = 0;
    for (const step of steps) {
      const at = square + step; if (!(at & 0x88) && this.cells[at] === want) found++; seen += this.cells[at] === undefined ? 1 : 0;
      if (seen > 40) break;
    }
    return [found, seen, total, steps.length].join(" ");
  }
}
const board = new Board();
const lists: number[][] = [[1, 2, 3, -17], [-17, , 15, , 1, 2] as any];
let lines = "";
for (let round = 0; round < 3; round++)
  for (const steps of lists)
    for (const square of [1, 2, ...[0.5, 5, 7.25, 1]]) lines += board.count(square, steps.slice(), round - 1) + "|" + board.count(square, steps, 2) + "\n";
console.log(lines);
