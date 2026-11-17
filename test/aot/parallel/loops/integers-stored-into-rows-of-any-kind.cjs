// STATISTIC: IntegersStoredByKind >= 2
// Flags and counts that a nest stores into rows which it does not read: rows of fractions, of other values, frozen, shared, missing ones and ones that are no arrays take them as the written loop does.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 20) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" + value.length : ArrayBuffer.isView(value) ? "V" + Array.from(value).join() : typeof value === "object" && value ? "o" : String(value);
function life(g, h, n) {
  for (let i = 1; i < n - 1; i++) for (let j = 1; j < n - 1; j++) {
    let s = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (di || dj) s += g[i + di][j + dj];
    h[i][j] = s === 3 || (s === 2 && g[i][j]) ? 1 : 0;
  }
  return h;
}
function marks(g, h, n) {
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < 2; k++) s += g[j][k];
    h[i][j] = s > 1 ? i : -j;
  }
  return h;
}
const n = 8;
const kinds = { bit: (i, j) => (i * 7 + j * 3 + i * j) % 3 === 0 ? 1 : 0, real: (i, j) => Math.sin(i * 7 + j * 3), text: (i, j) => (i + j) % 4 ? 1 : "x", missing: (i, j) => (i * j) % 5 === 4 ? undefined : (i + j) % 2, flag: (i, j) => (i + j) % 3 > 0, big: (i, j) => 2 ** 31 + i, object: i => ({ valueOf: () => i % 2 }), half: i => i / 2 };
const grid = make => { const rows = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(make(i, j)); rows.push(row); } return rows; };
const changes = { none() { }, hole(g, h) { delete h[2][3]; delete g[3][3]; }, short(g, h) { h[3].length = 2; }, same(g, h) { h[3] = g[3]; }, shared(g, h) { h[4] = h[2]; }, frozen(g, h) { Object.freeze(h[5]); }, view(g, h) { h[2] = new Float64Array(n); h[4] = new Uint8Array(n); }, literal(g, h) { h[3] = [1, 2, 3, 4, 5, 6, 7, 8]; h[4] = [0.5, 1, 2, 3, 4, 5, 6, 7]; }, null(g, h) { h[5] = null; }, accessor(g, h) { Object.defineProperty(h[2], 2, { get() { return 7; }, set(x) { g[4][4] = x + 5; }, configurable: true }); }, proxy(g, h) { h[3] = new Proxy(h[3], { set(t, k, x) { t[k] = x + 1; return true; } }); } };
for (const nest of [life, marks]) {
  const out = [];
  for (const kind in kinds) for (const other in kinds) for (const change in changes) {
    const g = grid(kinds[kind]), h = grid(kinds[other]);
    changes[change](g, h);
    let text;
    try { text = show(nest(g, h, n)); } catch (error) { text = error.constructor.name + show(h); }
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    out.push((sum >>> 0).toString(36));
  }
  console.log(nest.name, out.join(" "));
}
