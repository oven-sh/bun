// The outer loop and the inner loop each join a value that nothing reads, and the inner one passes the outer one on.
function quotient(rows, x) {
  const d = rows.map(row => row.slice());
  const n = d.length, m = d[0].length;
  for (let i = 0; i < n; i++) {
    const outer = x > 1 ? i * 0.5 : n / 3;
    for (let j = 0; j < m; j++) {
      const chosen = x > 1 ? outer : d[i][j];
      d[i][j] += j * 0.5;
    }
  }
  return d;
}
function assigned(rows, x) {
  const d = rows.map(row => row.slice());
  const n = d.length, m = d[0].length;
  for (let i = 0; i < n; i++) {
    let outer = n / 3;
    if (x > 1)
      outer = i * 0.5;
    for (let j = 0; j < m; j++) {
      const chosen = x > 1 ? outer : d[i][j];
      d[i][j] = d[i][j] * 2 - j;
    }
  }
  return d;
}
function isRead(rows, x) {
  const d = rows.map(row => row.slice());
  const n = d.length, m = d[0].length;
  for (let i = 0; i < n; i++) {
    const outer = x > 1 ? i * 0.5 : n / 3;
    for (let j = 0; j < m; j++) {
      const chosen = x > 1 ? outer : d[i][j];
      d[i][j] += j * outer;
    }
  }
  return d;
}
const tables = JSON.parse("[[[1], [2], [3]], [[1, 2, 3], [4, 5, 6]], [[0.5, 1], [2, 3], [4, 5], [6, 7]], [[1.5, -0, 2.5], [3, 4, 5], [6, 7.25, 8]], [[1, \"x\"], [2, 3]], [[1, null], [2, 3]]]");
for (const rows of tables) {
  for (const x of [0, 1.5, 6]) {
    for (const run of [quotient, assigned, isRead])
      console.log(run.name, JSON.stringify(run(rows, x)));
  }
}
