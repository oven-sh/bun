"use strict";
function scaled(n, rows, s, c, m, l) { for (let i = m - 1; i >= l; i--) { for (let k = 0; k < n; k++) rows[k][i] = c * rows[k][i] - s; } return rows; }
function rotated(n, rows, s, c, m, l) { let h; for (let i = m - 1; i >= l; i--) { for (let k = 0; k < n; k++) { h = rows[k][i + 1]; rows[k][i + 1] = s * rows[k][i] + c * h; rows[k][i] = c * rows[k][i] - s * h; } } return rows; }
function summedDown(n, rows, width) { for (let k = 1; k < n; k++) { for (let j = 0; j < width; j++) rows[k][j] = rows[k - 1][j] + rows[k][j]; } return rows; }
function laid(n, rows, value, at) { for (let k = 0; k < n; k++) rows[k][at] = value; return rows; }
function shown(rows) { return rows.map((row) => (row === null || row === undefined ? String(row) : typeof row === "string" ? row : Array.from(row, (x) => (x === undefined ? "-" : typeof x === "bigint" ? x + "n" : String(x))).join())).join(";"); }
function said(run) { try { return shown(run()); } catch (error) { return error.constructor.name; } }
const parsed = JSON.parse("[[0.5,1.5,2.5,3.5,4.5],[5.5,6.5,7.5,8.5,9.5],[10.5,11.5,12.5,13.5,14.5],[1.25,2.25,3.25,4.25,5.25]]");
class Row extends Array {}
class Watched extends Array { }
Object.defineProperty(Watched.prototype, 2, { set(value) { Watched.heard.push(value); }, get() { return 7; }, configurable: true });
Watched.heard = [];
const makers = {
  fractions: (r) => r.slice(), whole: (r) => r.map(Math.round), texts: (r) => r.map(String), mixed: (r) => r.map((x, i) => (i % 2 ? x : String(x))),
  holed: (r) => { const l = r.slice(); delete l[2]; return l; }, holedWhole: (r) => { const l = r.map(Math.round); delete l[3]; return l; }, short: (r) => r.slice(0, 2), empty: () => [],
  frozen: (r) => Object.freeze(r.slice()), sealed: (r) => Object.seal(r.slice()), closed: (r) => Object.preventExtensions(r.slice(0, 3)), written: () => [1.5, 2.5, 3.5, 4.5, 5.5], writtenWhole: () => [1, 2, 3, 4, 5],
  heirs: (r) => Row.from(r), watched: (r) => { const l = new Watched(); l[0] = r[0]; l[1] = r[1]; l.length = 5; return l; }, sparse: (r) => { const l = r.slice(); l[5000] = 1; return l; },
  doubles: (r) => Float64Array.from(r), floats: (r) => Float32Array.from(r), ints: (r) => Int32Array.from(r), bytes: (r) => Uint8Array.from(r), clamped: (r) => Uint8ClampedArray.from(r), buffers: (r) => Buffer.from(r),
  shortViews: (r) => Float64Array.from(r.slice(0, 2)), big: (r) => BigInt64Array.from(r.map((x) => BigInt(Math.round(x)))), objects: (r) => ({ ...r }), textRows: (r) => r.join(""),
};
for (let round = 0; round < 3; round++) {
  for (const [name, make] of Object.entries(makers)) {
    Watched.heard.length = 0;
    console.log(round, name, "scaled", said(() => scaled(4, parsed.map(make), 0.25, 0.5, 4, 1)));
    console.log(round, name, "rotated", said(() => rotated(4, parsed.map(make), 0.6, 0.8, 4, 1)));
    console.log(round, name, "summed down", said(() => summedDown(4, parsed.map(make), 5)));
    for (const value of [9, 9.5, "nine", null, undefined, -0, NaN, 2 ** 31, { toString() { return "an object"; } }]) console.log(round, name, "laid", typeof value, said(() => laid(4, parsed.map(make), value, 2)), said(() => laid(4, parsed.map(make), value, 5)), said(() => laid(4, parsed.map(make), value, 9)));
    if (Watched.heard.length) console.log(round, name, "heard", Watched.heard.length, Watched.heard.slice(0, 4).join());
  }
}
