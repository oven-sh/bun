// STATISTIC: ElementMoveLoops >= 3
// Numbers that go around a loop and grow by elements of arrays nobody knows: `let s = v[j]; s += c[k][j]`. Starts and elements that are no numbers, NaN, -0, holes, arrays of other kinds and elements that change arrays give the answers of the written loop.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 12) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" : typeof value === "object" && value ? "o" : typeof value === "bigint" ? value + "n" : String(value);
let hooked;
const sums = {
  column(c, v, n, j) { let s = v[j]; for (let k = 0; k < n; k++) s += c[k][j]; return s; },
  weighted(c, v, n, j, x) { let s = x; for (let k = 0; k < n; k++) s = s * 0.5 + c[k][j] * v[k]; return s; },
  down(c, v, n, j, x) { let s = x; for (let k = n - 1; k >= 0; k--) s -= c[k][j]; return s; },
  kept(c, v, n, j) { let s = v[0]; for (let k = 0; k < n; k++) { c[k][j] = s; s += v[k]; } return s; },
  two(c, v, n, j, x) { let s = v[1], t = x; for (let k = 0; k < n; k++) { s += c[k][j]; t = t * 0.5 + c[k][j]; } return [s, t]; },
};
const n = 6;
const kinds = { real: (i, j) => Math.sin(i * 7 + j * 3 + 1), whole: (i, j) => (i * 5 + j * 3) % 7 - 3, text: (i, j) => "t" + (i + j), object: (i, j) => ({ valueOf() { if (hooked) hooked[i] = [1, 2, 3, 4, 5, 6]; return i - j; } }), mixed: (i, j) => (i + j) % 3 ? i / 2 : "x" + j, missing: (i, j) => (i * j) % 5 === 4 ? undefined : i - j / 2, zero: () => -0, huge: (i, j) => (i + j) % 2 ? 1e308 : -1e308, big: (i, j) => (i + j) % 4 === 3 ? 3n : i, nan: (i, j) => i === j ? NaN : i / 3 };
const grid = make => { const rows = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(make(i, j)); rows.push(row); } return rows; };
const starts = [0, -0, 0.5, "s", undefined, null, NaN, Infinity, 5n, { valueOf: () => 3 }, true, 2 ** 31];
const changes = { none() { }, hole(c, v) { delete c[3][2]; delete v[1]; }, short(c) { c[4].length = 2; }, shared(c, v) { c[3] = v; }, view(c) { c[3] = new Float64Array(n); }, kind(c) { c[3][2] = "other"; }, hooked(c) { hooked = c; }, null(c) { c[4] = null; } };
for (const sum in sums) {
  const out = [];
  for (const kind in kinds) for (const other of [kind, kind === "real" ? "whole" : "real"]) for (const change in changes) {
    const c = grid(kinds[kind]), v = grid(kinds[other])[2], x = starts[out.length % starts.length];
    hooked = undefined;
    changes[change](c, v);
    let text;
    try { text = show(sums[sum](c, v, n, 2, x)); } catch (error) { text = error.constructor.name; }
    out.push(text + (sum === "kept" ? show(c[5]) : ""));
  }
  console.log(sum, out.join(" "));
}
