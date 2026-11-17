// An integer made between the read of an element and its store: the box of the sum makes the number, so nothing else has made it.
class List extends Array { }
function f1(rows, turn, n) {
  const log = [];
  for (let j = 0; j < 5; j++) { for (let k = 0; k < n; k++) { rows[k][j] += k + j; if (turn === 2 && k === 1 && j === 1) { rows.length = k; } } } log.push(String(rows));
  return log.join();
}
const out = [];
for (let turn = 0; turn < 4; turn++) for (const make of [() => [[7], 17, new Array(5).fill(3), [1, 2, 3, 4, 5], [1, 2.5, 3, 4, 5]], () => [new Array(5), [1, 2, 3, 4, 5].concat([6]), [], [5, 4, 3, 2, 1], [5, 4, 3, 2, 1]], () => [[0.5, 1.5], List.from([1, 2, 3]), ["a", "b"], [2147483647, -2147483648], [1n]]]) {
  try { out.push(f1(make(), turn, 5)); } catch (error) { out.push(error.constructor.name); }
}
console.log(out.join("\n"));
