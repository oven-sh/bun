// Rows that loops fill by push: the number pushed is stored under no key that the text names.
// STATISTIC: PushesCompiledAsAppends >= 1
function made(n, m, f) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < m; j++) row.push(f(i, j));
    rows.push(row);
  }
  return rows;
}
function filled(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i * 0.5);
  return list;
}
function sums(rows, n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < rows[i].length; j++) s += rows[i][j];
    list.push(s);
  }
  return list;
}
const whole = made(6, 5, (i, j) => i * j), halves = made(5, 6, (i, j) => i + j / 2), words = made(2, 2, (i, j) => "w" + i + j);
console.log(JSON.stringify([whole, halves, words, filled(9), sums(whole, 6), sums(halves, 5), made(0, 3, Math.max), made(3, 0, Math.max)]));
