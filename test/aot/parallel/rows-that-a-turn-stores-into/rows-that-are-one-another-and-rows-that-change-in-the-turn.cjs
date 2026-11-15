"use strict";
function rotated(n, rows, s, c, m, l) { let h; for (let i = m - 1; i >= l; i--) { for (let k = 0; k < n; k++) { h = rows[k][i + 1]; rows[k][i + 1] = s * rows[k][i] + c * h; rows[k][i] = c * rows[k][i] - s * h; } } return rows; }
function summedDown(n, rows, width) { for (let k = 1; k < n; k++) { for (let j = 0; j < width; j++) rows[k][j] = rows[k - 1][j] + rows[k][j]; } return rows; }
function crossed(n, rows) { for (let k = 0; k < n; k++) rows[k][1] = rows[(k + 1) % n][1] + rows[k][0]; return rows; }
function widened(n, rows, values) { for (let k = 0; k < n; k++) { rows[k][0] = values[k]; rows[k][1] = rows[k][0] + rows[k][2]; } return rows; }
function replaced(n, rows, other) { for (let k = 0; k < n; k++) { rows[k][0] = rows[k][1] * 2; if (k === 1) rows[2] = other; rows[k][2] = rows[k][0] + 1; } return rows; }
function grown(n, rows) { for (let k = 0; k < n; k++) { rows[k][rows[k].length] = rows[k][0] + 0.5; rows[k][0] = rows[k][rows[k].length - 1] * 2; } return rows; }
function shrunk(n, rows) { for (let k = 0; k < n; k++) { rows[k][1] = rows[k][2] + 1; if (k === 0) rows[1].length = 1; rows[k][2] = rows[k][1] * 2; } return rows; }
function intoTheMatrix(n, rows) { for (let k = 0; k < n; k++) rows[k][1] = rows[k][0]; return rows.length; }
function shown(rows) { return rows.map((row) => (Array.isArray(row) || ArrayBuffer.isView(row) ? Array.from(row, (x) => (Array.isArray(x) ? "[..]" : String(x))).join() : String(row))).join(";"); }
function said(run) { try { const made = run(); return typeof made === "number" ? String(made) : shown(made); } catch (error) { return error.constructor.name; } }
const fresh = () => JSON.parse("[[0.5,1.5,2.5,3.5],[4.5,5.5,6.5,7.5],[8.5,9.5,10.5,11.5]]"), whole = () => JSON.parse("[[1,2,3,4],[5,6,7,8],[9,10,11,12]]");
for (let round = 0; round < 3; round++) {
  for (const [name, make] of [["fractions", fresh], ["whole", whole], ["views", () => fresh().map((r) => Float64Array.from(r))], ["a list, a view, a list", () => { const m = fresh(); m[1] = Float64Array.from(m[1]); return m; }]]) {
    const same = () => { const m = make(); m[1] = m[0]; m[2] = m[0]; return m; };
    console.log(round, name, "each row is the first", said(() => rotated(3, same(), 0.6, 0.8, 3, 0)), said(() => summedDown(3, same(), 4)), said(() => crossed(3, same())));
    console.log(round, name, "apart", said(() => rotated(3, make(), 0.6, 0.8, 3, 0)), said(() => summedDown(3, make(), 4)), said(() => crossed(3, make())));
    console.log(round, name, "widened", said(() => widened(3, make(), [1.5, "two", null])), said(() => widened(3, make(), [7, 8.25, 9])), said(() => widened(3, make(), [undefined, {}, 2 ** 40])));
    console.log(round, name, "replaced", said(() => replaced(3, make(), ["a", "b", "c"])), said(() => replaced(3, make(), Float32Array.of(1, 2, 3))), said(() => replaced(3, make(), null)));
    console.log(round, name, "grown", said(() => grown(3, make())), "shrunk", said(() => shrunk(3, make())));
  }
  const holdsItself = [[1.5, 2.5], [3.5, 4.5]]; holdsItself.push(holdsItself);
  console.log(round, "the matrix is a row of itself", said(() => intoTheMatrix(3, holdsItself)), Array.isArray(holdsItself[1]), holdsItself[1] === holdsItself[0]);
  const sharedBytes = new ArrayBuffer(32), overlapping = [new Float64Array(sharedBytes, 0, 3), new Float64Array(sharedBytes, 8, 3), new Float64Array(sharedBytes, 0, 4)]; overlapping[2].set([1.5, 2.5, 3.5, 4.5]);
  console.log(round, "views over the same bytes", said(() => rotated(3, overlapping, 0.6, 0.8, 2, 0)), said(() => crossed(3, overlapping)));
}
