"use strict";
function summed(n, rows) { let s = 0; for (let k = 0; k < n; k++) s += rows[k][2] * 2; return s; }
function laid(n, rows, from) { for (let k = 0; k < n; k++) rows[k][2] = from[k] * 2; return rows; }
function both(n, rows) { let s = 0; for (let k = 0; k < n; k++) { rows[k][1] = rows[k][0] + rows[k][2]; s += rows[k][1]; } return s; }
function outside(n, rows) { let s = 0; for (let k = 0; k < n; k++) s += rows[k][7] * 2; return s; }
const parsed = JSON.parse("[[0.5,1.5,2.5,3.5],[4.5,5.5,6.5,7.5],[8.5,9.5,300.75,-1.5]]");
class Row extends Array {}
class View extends Float64Array {}
const makers = {
  fractions: (r) => r.slice(), whole: (r) => r.map(Math.round), texts: (r) => r.map(String), holed: (r) => { const l = r.slice(); delete l[2]; return l; }, frozen: (r) => Object.freeze(r.slice()),
  heirs: (r) => Row.from(r), doubles: (r) => Float64Array.from(r), floats: (r) => Float32Array.from(r), ints: (r) => Int32Array.from(r), unsigned: (r) => Uint32Array.from(r.map(Math.abs)), shorts: (r) => Int16Array.from(r),
  bytes: (r) => Uint8Array.from(r), clamped: (r) => Uint8ClampedArray.from(r), signedBytes: (r) => Int8Array.from(r), buffers: (r) => Buffer.from(r), heirsOfViews: (r) => View.from(r), short: (r) => Float64Array.from(r.slice(0, 2)),
  objects: (r) => ({ 0: r[0], 1: r[1], 2: r[2] }), textRows: (r) => r.join(""), big: (r) => BigInt64Array.from(r.map((x) => BigInt(Math.round(x)))),
};
const from = Float64Array.of(1.25, -2.5, 1000.5);
function said(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
for (let round = 0; round < 3; round++) {
  for (const [name, make] of Object.entries(makers)) {
    console.log(round, name, said(() => summed(3, parsed.map(make))), said(() => outside(3, parsed.map(make))), said(() => both(3, parsed.map(make))), said(() => laid(3, parsed.map(make), from).map((row) => Array.from(row).join()).join(";")));
  }
  const mixed = [makers.fractions(parsed[0]), makers.doubles(parsed[1]), makers.bytes(parsed[2])];
  console.log(round, "mixed", summed(3, mixed), both(3, mixed), laid(3, mixed, from).map((row) => Array.from(row).join()).join(";"));
  console.log(round, "a row is missing", said(() => summed(3, [parsed[0], undefined, parsed[2]])), said(() => summed(3, [Float64Array.of(1, 2, 3), null, parsed[2]])));
}
const detached = [Float64Array.of(1, 2, 3), Float64Array.of(4, 5, 6), Float64Array.of(7, 8, 9)];
structuredClone(detached[1].buffer, { transfer: [detached[1].buffer] });
console.log("a view whose bytes have gone", summed(3, detached), said(() => laid(3, detached, from).map((row) => Array.from(row).join()).join(";")));
