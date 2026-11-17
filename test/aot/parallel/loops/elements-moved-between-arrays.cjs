// STATISTIC: ElementMoveLoops >= 8
// Loops that only move elements between arrays move words, whatever the kind of the arrays. Arrays of other kinds, holes, positions outside, rows that are no arrays, rows that stand in two places, frozen and shared arrays, accessors
// and proxies give the answers of the written loop.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: value.length }, (_, i) => i in value ? (value[i] === value ? "self" : show(value[i])) : "!").join() + "]" : ArrayBuffer.isView(value) ? "V" + Array.from(value).join() : typeof value === "object" && value ? "o" + Object.keys(value).length : String(value);
const moves = {
  transposed(a, b) { for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) b[j][i] = a[i][j]; },
  rows(a, b, n) { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) b[i][j] = a[i][j]; },
  column(a, b, n, v) { for (let i = 0; i < n; i++) b[i][2] = v[i]; },
  spread(a, b, n, v) { for (let i = 0; i < n; i++) b[i][1] = v[2]; },
  columns(a, b, n) { for (let i = 0; i < n; i++) b[i][1] = a[i][2]; },
  below(a, b, n) { for (let i = 1; i < n; i++) b[i][i - 1] = a[i - 1][i]; },
  inPlace(a, b, n) { for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const t = b[i][j]; b[i][j] = b[j][i]; b[j][i] = t; } },
  gathered(a, b, n, v, x) { const w = b[0]; for (let i = 0; i < n; i++) w[i] = v[x[i]]; },
  scattered(a, b, n, v, x) { const w = b[1]; for (let i = 0; i < n; i++) w[x[i]] = v[i]; },
  backwards(a, b, n, v) { for (let i = 0; i < n; i++) b[n - 1 - i][0] = v[i]; },
  turned(a, b, n) { const f = b[0]; for (let i = 0; i + 1 < n; i++) b[i] = b[i + 1]; b[n - 1] = f; },
  swapped(a, b, n) { for (let i = 0; i < n; i++) { const t = a[i][0]; a[i][0] = b[i][1]; b[i][1] = t; } },
  ofLength(a, b, n, v) { const w = b[2]; for (let i = 0; i < v.length; i++) w[i] = a[i][i]; },
};
const n = 6;
const kinds = {
  real: (i, j) => Math.sin(i * 7 + j * 3 + 1), whole: (i, j) => (i * 5 + j * 3) % 7 - 3, text: (i, j) => "t" + (i + j), object: (i, j) => ({ [i]: j }), mixed: (i, j) => (i + j) % 3 ? i / 2 : "x" + j,
  zero: () => -0, missing: (i, j) => (i * j) % 5 === 4 ? undefined : i - j / 2, nothing: () => null, list: (i, j) => [i, j], big: (i, j) => 2 ** 31 + i * j,
};
const grid = make => { const rows = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(make(i, j)); rows.push(row); } return rows; };
class Rows extends Array { }
const changes = {
  none() { }, hole(a, b, v) { delete a[2][3]; delete b[3][2]; delete v[4]; }, short(a, b, v) { a[4].length = 3; b[2].length = 4; }, shared(a, b) { b[3] = b[1]; }, same(a, b) { b[2] = a[2]; }, self(a, b) { b[2] = b; }, selfToo(a, b) { a[1] = a; b[1] = a; },
  frozen(a, b) { Object.freeze(b[4]); }, sealed(a, b) { Object.seal(b[0]); }, view(a, b) { b[3] = new Float64Array(n); a[4] = new Uint8Array(n); }, record(a, b) { b[4] = { 0: 1, length: 2 }; a[3] = { 0: 5, 1: 6 }; }, text(a, b) { a[2] = "abcdef"; },
  null(a, b) { b[5] = null; }, undefined(a, b) { a[5] = undefined; }, accessor(a, b) { Object.defineProperty(b[2], 3, { get() { return 7; }, set(x) { b[0][0] = x; }, configurable: true }); Object.defineProperty(a[2], 1, { get() { b[1] = []; return 9; }, configurable: true }); },
  proxy(a, b) { b[1] = new Proxy(b[1], { set(t, k, x) { t[k] = x; b[4] = [1, 2, 3, 4, 5, 6]; return true; } }); }, subclass(a, b) { b[2] = Rows.from(b[2]); a[2] = Rows.from(a[2]); }, kind(a, b) { b[3][0] = "other"; a[3][1] = 0.25; }, literal(a, b) { b[2] = [1, 2, 3, 4, 5, 6]; a[1] = [0.5, 1, 2, 3, 4, 5]; },
  sparse(a, b) { b[3][100000] = 1; }, grown(a, b) { b.length = 4; }, frozenAll(a, b) { Object.freeze(b); },
};
const keys = { order: [3, 1, 4, 0, 5, 2], twice: [1, 1, 2, 2, 0, 0], real: [2.5, 1, 4, 0, 5, 2], doubles: [0.5, 1, 4, 0, 5, 2].map((x, i) => i ? x : 3), outside: [1, 2, 40, 0, -1, 3], text: [1, 2, "0", "length", 4, 3], holes: [1, , 2, 0, 3, 4] };
for (const move in moves) {
  const out = [];
  for (const kind in kinds) {
    for (const other of [kind, kind === "real" ? "whole" : "real"]) {
      for (const change in changes) {
        if (other !== kind && change !== "none" && change !== "hole" && change !== "self") continue;
        const a = grid(kinds[kind]), b = grid(kinds[other]), v = grid(kinds[kind])[3];
        let thrown = "";
        try { changes[change](a, b, v); moves[move](a, b, n, v, keys.order); } catch (error) { thrown = error.constructor.name; }
        let text = thrown;
        try { text += show(a) + show(b); } catch (error) { text += error.constructor.name; }
        let sum = 0;
        for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
        out.push((sum >>> 0).toString(36));
      }
    }
  }
  console.log(move, out.join(" "));
}
for (const move of ["gathered", "scattered"]) for (const key in keys) {
  const a = grid(kinds.real), b = grid(kinds.real), v = grid(kinds.real)[3];
  try { moves[move](a, b, n, v, keys[key].slice()); } catch (error) { console.log(error.constructor.name); }
  console.log(move, key, show(b[0]), show(b[1]));
}
// Young objects that old arrays take are kept.
const old = grid(kinds.object), young = [];
for (let round = 0; round < 40; round++) {
  const fresh = grid((i, j) => ({ value: round * 100 + i * 10 + j }));
  moves.transposed(fresh, old);
  if (round % 8 === 0) Bun.gc(true);
  for (let k = 0; k < 2000; k++) young.push({ k });
  young.length = 0;
}
console.log(old.map(row => row.map(x => x.value).join()).join(" "));
// Long columns, and a counter that starts late or ends beyond the rows.
const long = [];
for (let i = 0; i < 5000; i++) long.push([i / 2, i, -i]);
const target = new Array(5000).fill(0.5);
function copyColumn(to, rows, from, end, k) { for (let i = from; i < end; i++) to[i] = rows[i][k]; return to; }
function putColumn(rows, from, end, k, v) { for (let i = from; i < end; i++) rows[i][k] = v[i]; return rows; }
let sum = 0;
for (const x of copyColumn(target, long, 17, 4000, 1)) sum += x;
console.log(sum);
try { copyColumn(target, long, 4990, 5010, 2); } catch (error) { console.log(error.constructor.name, target.length, target[4999]); }
try { putColumn(long, 4990, 5010, 0, target); } catch (error) { console.log(error.constructor.name, long[4999][0]); }
try { putColumn(long, -2, 3, 1, target); } catch (error) { console.log(error.constructor.name); }
console.log(show(long[0]), show(long[2]), target.length);
