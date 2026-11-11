// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
// undefined among the steps and among the squares.
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
      const at = square + step; const cell = this.cells[at]; if (cell === want) found++; else if (cell !== 0) seen++;
      if (seen > 40) break;
    }
    return [found, seen, total, steps.length].join(" ");
  }
}
const board = new Board();
const lists: number[][] = [[1, 2, 3, -17], [1, undefined as any, 3, 4]];
let lines = "";
for (let round = 0; round < 3; round++)
  for (const steps of lists)
    for (const square of [1, 2, ...[undefined as any, 3, 4]]) lines += board.count(square, steps.slice(), round - 1) + "|" + board.count(square, steps, 2) + "\n";
console.log(lines);
