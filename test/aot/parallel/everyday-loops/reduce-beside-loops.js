// Reduce chains beside loops that write the list which they read
function totals(rows) {
  const sums = [];
  for (let i = 0; i < rows.length; i++) {
    sums.push(rows[i].reduce((sum, value) => sum + value, 0));
    for (let k = 0; k < rows[i].length; k++) rows[i][k] = rows[i][k] * 2;
    sums.push(rows[i].filter(value => value > 4).map((value, at) => value - at).reduce((a, b) => (a > b ? a : b), -1));
  }
  return sums.reduce((text, value) => text + "," + value) + " " + rows.map(row => row.length).reduce((a, b) => a + b, 0);
}
console.log(totals([[1, 2, 3], [4], []]));
console.log(totals([[0.5, 2.5], [NaN], [-0]]));
console.log(totals([["a", "b"], [1, "2"]]));
