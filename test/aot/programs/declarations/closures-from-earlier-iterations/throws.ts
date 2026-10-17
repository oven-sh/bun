type Cell = { filled: object | null };
function throwsInTheSecondRound(): { rounds: number } {
  const earlier: Array<() => Cell> = [];
  let rounds = 0;
  for (const round of [1, 2]) {
    const cell: Cell = { filled: null };
    for (const get of earlier) { if (get().filled) throw new RangeError("the second round"); }
    earlier.push(() => cell);
    cell.filled = {};
    rounds += round;
  }
  return { rounds };
}
export const thrown = throwsInTheSecondRound();
