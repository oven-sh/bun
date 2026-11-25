// Values and weights of four things, the best of every weight pushed
function best(values, weights) {
  let row = [0, 0, 0, 0, 0, 0];
  const all = [];
  for (let i = 0; i < 4; i++) {
    const next = [];
    for (let w = 0; w < 6; w++) {
      const taken = w >= weights[i] ? row[w - weights[i]] + values[i] : 0;
      next.push(taken > row[w] ? taken : row[w]);
    }
    all.push(next[5]);
    row = next;
  }
  return row.join() + " ; " + all.join();
}
console.log(best([3, 4, 5, 6], [2, 3, 4, 5]));
console.log(best([10, 1, 1, 1], [5, 1, 1, 1]));
console.log(best([1, 2, 3, 4], [1, 1, 1, 1]));
