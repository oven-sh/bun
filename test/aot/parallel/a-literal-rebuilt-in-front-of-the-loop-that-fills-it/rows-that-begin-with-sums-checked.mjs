// Under: --aot-harden=proof-checks: a row that begins with a sum which the loop inside goes on with is the row of the next turn: the build stopped
// Flags: --aot-harden=proof-checks
function tolls(m, n) {
  let sum = 0, last = [0];
  for (let i = 0; i < m; i++) {
    const row = [sum];
    for (let j = 0; j < n; j++) {
      const toll = last[0] + (last[j] ?? 0);
      row.push(toll);
      sum += toll + 1;
    }
    last = row;
  }
  return [last, sum];
}
function fees(m, n) {
  let sum = 0.5, last = [0];
  for (let i = 0; i < m; i++) {
    const row = [sum, i];
    for (let j = 0; j < n; j++) {
      row.push(last[0]);
      sum += last[0] * 0.5;
    }
    last = row;
    sum += row.length;
  }
  return [last[n], sum];
}
function least(m, n, given) {
  let sum = 0, low = Infinity, last = given;
  for (let i = 1; i <= m; i++) {
    const row = [sum];
    for (let j = 1; j <= n; ++j) {
      row.push((last[i] ?? 0) * 0.5);
      sum += given[n - j] ?? 0;
      if (row[row.length - 1] < low) low = row[row.length - 1];
    }
    last = row;
    if (row[0] > 12) return last;
  }
  return [last[n], sum, low];
}
function names(m, n) {
  let text = "", last = ["a"];
  for (let i = 0; i < m; i++) {
    const row = [text];
    for (let j = 0; j < n; j++) {
      row.push(last[0]);
      text += last[0].length + "b";
    }
    last = row;
  }
  return [last, text];
}
const held = JSON.parse("{}");
for (const f of [tolls, fees, least, names]) held[f.name + process.pid] = f;
for (const [m, n, given] of [[3, 2, [1, 2, 3]], [0, 4, [1]], [5, 12, [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]], [4, 1, [2, 2]]]) {
  console.log(JSON.stringify(tolls(m, n)), JSON.stringify(held["tolls" + process.pid](m, n)));
  console.log(JSON.stringify(fees(m, n)), JSON.stringify(held["fees" + process.pid](m, n)));
  console.log(JSON.stringify(least(m, n, given)), JSON.stringify(held["least" + process.pid](m, n, given)));
  console.log(JSON.stringify(names(m, n)).length, JSON.stringify(held["names" + process.pid](m, n)).length);
}
