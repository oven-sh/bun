// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: the copy is read again behind the store in the same turn.
const board = { scores: [] };
function scale(scores, factor) {
  const next = [...scores];
  board.scores = next;
  let best = 0;
  for (let i = 0; i < next.length; i++) {
    board.scores[i] = Math.round(next[i] * factor);
    if (next[i] > best) best = next[i];
  }
  return best;
}
console.log(scale([10, 20, 30], Number(process.argv[2] ?? 1.5)), board.scores[0]);
