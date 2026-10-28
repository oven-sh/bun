const rows = JSON.parse('[{"n":"x"},{"n":1},{"n":"a"}]');
function increment(row) {
  const o = {};
  o.n = row.n + 1;
  return "n" in o ? o.n : "lost";
}
const pushed = [];
for (const row of rows) pushed.push(increment(row));
console.log(pushed.join(","));
console.log(rows.map(increment).join(","));
const visited = [];
rows.forEach(row => visited.push(increment(row)));
console.log(visited.join(","));
