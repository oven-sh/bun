// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
// Sums and differences beyond the range of an int32.
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
      const at = square - step; if (this.cells[at & 127] === want) found++; seen = (seen * 31 + (at | 0)) | 0;
      if (seen > 40) break;
    }
    return [found, seen, total, steps.length].join(" ");
  }
}
const board = new Board();
const lists: number[][] = [[1, 2, 3, -17], [2147483647, -2147483648, 4294967295, 1]];
let lines = "";
for (let round = 0; round < 3; round++)
  for (const steps of lists)
    for (const square of [1, 2, ...[2147483640, 4294967290, 9007199254740991, 2]]) lines += board.count(square, steps.slice(), round - 1) + "|" + board.count(square, steps, 2) + "\n";
console.log(lines);
