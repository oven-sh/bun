// STATISTIC: ElementMoveLoops >= 8
// Loops that store numbers computed from elements of arrays nobody knows: columns, places, rows beside columns. Integers, strings, holes, NaN, big integers, objects with valueOf that change the arrays, shared and frozen rows give the answers of the written loop.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 12) }, (_, i) => i in value ? (value[i] === value ? "self" : show(value[i])) : "!").join() + "]" + value.length : typeof value === "object" && value ? "o" : typeof value === "bigint" ? value + "n" : String(value);
let hooked;
const moves = {
  scaled(a, b, n, v, j, x) { for (let i = 0; i < n; i++) b[i][j] *= x; },
  added(a, b, n, v, j, x) { for (let i = 0; i < n; i++) b[i][j] += a[i][j]; },
  doubled(a, b, n, v, j) { for (let i = 0; i < n; i++) b[i][j] = a[i][j] * 2 - 0.5; },
  summed(a, b, n, v, j) { for (let i = 0; i < n; i++) v[j] += a[i][j]; },
  counted(a, b, n, v, j) { for (let i = 0; i < n; i++) b[i][j]++; },
  byCounter(a, b, n, v, j, x) { for (let i = 0; i < n; i++) b[i][j] = a[i][j] / (i + 1) + x; },
  beside(a, b, n, v, j, x) { for (let i = n - 1; i >= 0; i--) b[i][j] -= v[i] * x; },
  nested(a, b, n, v, j, x) { for (let p = 0; p < n; p++) for (let i = 0; i < n; i++) b[i][p] = (a[p][i] - v[p]) * x; },
};
const n = 6;
const kinds = { real: (i, j) => Math.sin(i * 7 + j * 3 + 1), whole: (i, j) => (i * 5 + j * 3) % 7 - 3, text: (i, j) => "t" + (i + j), object: (i, j) => ({ valueOf() { if (hooked) hooked[i] = [1, 2, 3, 4, 5, 6]; return i - j; } }), mixed: (i, j) => (i + j) % 3 ? i / 2 : "x" + j, missing: (i, j) => (i * j) % 5 === 4 ? undefined : i - j / 2, zero: () => -0, huge: (i, j) => (i + j) % 2 ? 1e300 : -1e300, big: (i, j) => (i + j) % 4 === 3 ? 3n : i, nan: (i, j) => i === j ? NaN : i / 3 };
const grid = make => { const rows = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(make(i, j)); rows.push(row); } return rows; };
const changes = { none() { }, hole(a, b, v) { delete b[3][2]; delete a[2][2]; delete v[4]; }, short(a, b) { b[4].length = 2; }, shared(a, b) { b[3] = b[1]; }, same(a, b) { b[2] = a[2]; b[4] = a[5]; }, self(a, b) { b[2] = b; }, frozen(a, b) { Object.freeze(b[4]); }, view(a, b) { b[3] = new Float64Array(n); a[4] = new Uint8Array(n); }, kind(a, b) { b[3][2] = "other"; }, hooked(a, b) { hooked = b; }, accessor(a, b) { Object.defineProperty(b[2], 2, { get() { return 7; }, set(x) { b[0][0] = x; }, configurable: true }); } };
const factors = [2, 0.5, -0, NaN, "3", undefined, null, { valueOf: () => 4 }, Infinity, true];
for (const move in moves) {
  const out = [];
  for (const kind in kinds) for (const other of [kind, kind === "real" ? "whole" : "real"]) for (const change in changes) {
    const a = grid(kinds[kind]), b = grid(kinds[other]), v = grid(kinds[kind])[3], x = factors[out.length % factors.length];
    hooked = undefined;
    let text = "";
    changes[change](a, b, v);
    try { moves[move](a, b, n, v, out.length % 7 === 6 ? "2" : 2, x); } catch (error) { text = error.constructor.name; }
    try { text += show(b) + show(v); } catch (error) { text += error.constructor.name; }
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    out.push((sum >>> 0).toString(36));
  }
  console.log(move, out.join(" "));
}
const plain = grid(kinds.real), last = grid(kinds.real);
for (let k = 0; k < 50; k++) { moves.scaled(plain, last, n, plain[1], k % n, 1.25); moves.added(plain, last, n, plain[1], k % n, 1); moves.summed(plain, last, n, last[2], k % n); }
console.log(show(last), show(plain));
