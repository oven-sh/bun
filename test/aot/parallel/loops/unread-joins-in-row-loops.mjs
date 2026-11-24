// STATISTIC: RowMapLoops >= 3
// const up = i && table[i - 1][j]; table[i][j] = j + 1: nobody reads the joined value, so no path of the loop computes it.
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + Array.from(v, show).join(" ") + "]" : String(v);
const any = new Map();
function made(n, m) { const d = new Array(n).fill(new Array(m).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const up = i && d[i - 1][j]; d[i][j] += j + 1; } return d; }
function rows(P) { const n = P.length, m = P[0].length; const d = Array.from({ length: n }, () => new Array(m).fill(0.5)); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const up = i && d[i - 1][j]; d[i][j] = j + 1; } return d; }
function given(P, d) { const n = P.length, m = P[0].length; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const up = i && d[i - 1][j]; d[i][j] += j * 0.5; } return d; }
function chosen(P, d) { const n = P.length, m = P[0].length; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const up = i ? d[i - 1][j] : i, left = j > 0 && d[i][j - 1]; d[i][j] = P[i][j] * 2; } return d; }
function partly(P, d) { const n = P.length, m = P[0].length; let seen = 0; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const up = i && d[i - 1][j], side = i > 1 ? 3 : 4; d[i][j] = P[i][j] + side; seen += side; } return [seen, d]; }
console.log(show(made(3, 2)), show(made(1, 4)), show(rows([[1, 2], [3, 4], [5, 6]])));
const tables = [() => [[1, 2], [3, 4], [5, 6]], () => [[1.5, 2.5], [0.5, -0]], () => [[1]], () => [[1, "x"], [2, 3]], () => [[1, , 3], [4, 5, 6]], () => [[1, 2], null, [3, 4]], () => [[1, 2], [3]], () => [Object.freeze([1, 2]), [3, 4]], () => [new Float64Array([1, 2]), [3, 4]], () => JSON.parse("[[1,2,3],[4,5.5,6]]")];
for (const run of [made, rows, given, chosen, partly]) {
  let out = "";
  for (const P of tables) {
    for (const d of tables) {
      any.set(0, P()); any.set(1, d());
      try { out += show(run === made ? run(any.get(0).length, any.get(1).length) : run(any.get(0), any.get(1))) + ";"; } catch (error) { out += error.constructor.name + show(any.get(1)) + ";"; }
    }
  }
  console.log(run.name, out);
}
