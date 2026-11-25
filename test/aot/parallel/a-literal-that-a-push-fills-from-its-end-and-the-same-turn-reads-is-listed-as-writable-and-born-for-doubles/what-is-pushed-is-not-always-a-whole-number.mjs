const veil = value => JSON.parse("0", () => value);
const said = [];
// In some turn what is pushed is a fraction, not a number, minus zero, infinite, past 2^31, past 2^53; what is read one place behind takes it on.
function fill(row, odd, at) {
  const out = [];
  for (let i = 1; i <= 3; i++) {
    const next = [i];
    for (let j = 1; j < row.length; j++) next.push(Math.min(row[j] + 1, next[j - 1] + (j === at ? odd : 1), 1e300));
    out.push(next.map(value => Object.is(value, -0) ? "-0" : String(value)).join());
    row = next;
  }
  return out.join(";");
}
const table = { fill };
const rows = JSON.parse("[[0,1,2,3,4,5,6,7],[0.5,1.5,2.5,3.5],[9,8,7,6,5,4,3,2,1,0]]");
for (const odd of [1, 0.25, NaN, -0, -Infinity, Infinity, 2147483648, -2147483649, 9007199254740993, -1]) for (const row of rows) for (const at of [1, 3]) said.push(table[JSON.parse('"fill"')](row, odd, at));
function zeros(n) { const next = [-0]; for (let j = 1; j <= n; j++) next.push(Math.min(next[j - 1] + -0, 5)); return next.map(value => Object.is(value, -0) ? "-0" : String(value)).join(); }
for (let turn = 0; turn < 3; turn++) { for (let i = 0; i < 2; i++) said.push(zeros(3 + i)); }
console.log(said.join(" | "));
