// A row that the checks count is read again where a check of the same row fails late: both come together there.
const operations = globalThis.operations ?? {
  magnitude: Math.abs,
  isSmaller: (x, y) => x < y,
  less: (x, y) => x - y,
  plus: (x, y) => x + y,
  times: (x, y) => x * y,
  divided: (x, y) => x / y,
};
function make({ magnitude, isSmaller, less, plus, times, divided }) {
  /**
   * @param {number[][]} rows
   * @param {number} count
   * @param {number[][]} moved
   */
  function exchange(rows, count, moved) {
    for (let step = 0; step < count - 2; step++) {
      let best = 0;
      let largest = 0;
      for (let other = step + 1; other < count; other++) {
        const element = rows[other][step];
        if (isSmaller(magnitude(largest), magnitude(element))) {
          largest = element;
          best = other;
        }
      }
      if (isSmaller(magnitude(largest), 1e-9)) continue;
      if (best !== step + 1) {
        const first = rows[best];
        rows[best] = rows[step + 1];
        rows[step + 1] = first;
        for (let row = 0; row < count; row++) {
          const kept = rows[row][best];
          rows[row][best] = rows[row][step + 1];
          rows[row][step + 1] = kept;
        }
        const last = moved[best];
        moved[best] = moved[step + 1];
        moved[step + 1] = last;
      }
      for (let later = step + 2; later < count; later++) {
        const share = divided(rows[later][step], largest);
        if (share === 0) continue;
        for (let column = 0; column < count; column++)
          rows[later][column] = less(rows[later][column], times(share, rows[step + 1][column]));
        for (let row = 0; row < count; row++)
          rows[row][step + 1] = plus(rows[row][step + 1], times(share, rows[row][later]));
      }
    }
    return moved;
  }
  return exchange;
}
globalThis.exchange = make(operations);
const texts = [
  "[[1,2,0],[3,1,4],[0,5,2]]",
  "[[1.5,2,0],[0,1,4],[3,5,2.5]]",
  "[[1,2,0,3],[3,1,4,5],[0,5,2,1],[9,1,1,2.5]]",
  "[[1,\"2\",0],[0,1,4],[3,5,{}]]",
  "[[1,2],[0,1,4],[3,5]]",
];
for (const text of texts) {
  const rows = JSON.parse(text);
  const moved = rows.map((row, index) => [index]);
  console.log(JSON.stringify(globalThis.exchange(rows, rows.length, moved)), JSON.stringify(rows));
}
for (const makeRow of [() => new Float64Array([0.5, 1.5, 2.5]), () => "abc", () => [1, , 3], () => ({ 0: 1, 1: 2, 2: 3 })]) {
  const rows = [[1, 2, 3], makeRow(), [7.5, 8, 9]];
  const moved = [[0], [1], [2]];
  try {
    console.log(JSON.stringify(globalThis.exchange(rows, 3, moved)), JSON.stringify(rows));
  } catch (error) {
    console.log(error.name, JSON.stringify(rows));
  }
}
// The array is asked for its own rows while it is read: a getter in place of a row.
{
  const rows = [[1, 2, 3], [0, 5, 6], [7.5, 8, 9]];
  let asked = 0;
  Object.defineProperty(rows, 1, { get() { return asked++ % 2 ? [0, 5, 6] : [4, 1, 2]; }, set() {}, configurable: true, enumerable: true });
  console.log(JSON.stringify(globalThis.exchange(rows, 3, [[0], [1], [2]])), asked);
}
