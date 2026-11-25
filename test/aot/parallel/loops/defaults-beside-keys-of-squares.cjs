// while (x < w) { s += g[y * y + x] ?? 0; x++; if (x > 300) break; }: the generic version that is walked again is entered where a front has failed. What that front has proven of y * y is not known there.
function one(g, w, y) { let s = 0, x = 0; while (x < w) { s += g[y * y + x] ?? 0; x++; if (x > 300) break; } return s; }
function nullish(g, w, y) { let s = 0, x = 0; while (x < w) { if (g[y * y + x] == null) s++; else s += g[y * y + x]; x++; if (x > 300) break; } return s; }
function twice(g, w, y) { let s = .5, x = 0; while (x < w) { s -= g[y * y + x] ?? 0; { let v = g[y * y + x]; v ??= 0; s += v; } x++; if (x > 300) break; } return s; }
function counted(g, w, y) { let s = 0; for (let x = 0; x < w; x++) { if (g[y * y + x] == null) s++; else s += g[y * y + x]; if (x > 300) break; } return s; }
function early(g, w, y) { let s = 0; for (let x = 0; x < w; x++) { if (x > 300) break; s += g[y * y + x] ?? 1; } return s; }
function product(g, w, y, h) { let s = 0, x = 0; while (x < w) { s += g[y * h + x] ?? 0; x++; if (x > 300) break; } return s; }
function less(g, w, y) { let s = 0, x = 0; while (x < w) { s += g[y * y - x] ?? 2; x++; if (x > 300) break; } return s; }
function both(g, w, y, h, q) { let s = 0, x = 0; while (x < w) { s += (g[y * y + x] ?? 0) + (q[y * y + x] ?? 1); x++; if (x > 300) break; } return s; }
function nest(g, w, y0, h) { let s = 0; for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) { s += g[y * y + x] ?? 1; if (x > 300) break; } return s; }
function texts(g, w, y) { let t = '', x = 0; while (x < w) { t += g[y * y + x] ?? '-'; x++; if (x > 300) break; } return t; }
function sought(g, w, y) { let x = 0; while (x < w) { if ((g[y * y + x] ?? 0) === 5) break; x++; } return x; }
function kept(g, w, y) { const o = []; let x = 0; while (x < w) { o.push(g[y * y + x] ?? 0); x++; if (x > 300) break; } return o; }
function plain(g, w, y) { let s = 0, x = 0; while (x < w) { s += g[y * y + x]; x++; if (x > 300) break; } return s; }
function stored(g, w, y) { let x = 0; while (x < w) { g[y * y + x] = (g[y * y + x] ?? 0) + 1; x++; if (x > 300) break; } return g; }
const functions = [one, nullish, twice, counted, early, product, less, both, nest, texts, sought, kept, plain, stored];
const table = JSON.parse('{}');
for (const f of functions) Reflect.set(table, f.name + (process.pid & 0), f);
const say = v => Object.is(v, -0) ? '-0' : Array.isArray(v) ? '[' + Array.from(v, say).join() + ']' : ArrayBuffer.isView(v) ? v.constructor.name + v.join() : typeof v === 'string' ? JSON.stringify(v) : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ':' + say(v[k])) + '}' : String(v);
const list = (n, v) => { const l = []; for (let i = 0; i < n; i++) l.push(v(i)); return l; };
const J = v => JSON.parse(JSON.stringify(v));
const holders = [
  n => J(list(n, i => i * 7 % 11)), n => J(list(n, i => i + .25)), n => J(list(n, i => i % 5 ? i : null)), n => { const l = J(list(n, i => i + .5)); if (n > 2) delete l[2]; return l; },
  n => Float64Array.from(list(n, i => i / 4)), n => Int32Array.from(list(n, i => i - 3)), n => Uint8Array.from(list(n, i => i * 3)), n => list(n, i => 'abc'[i % 3]).join(''), n => list(n, i => 'x' + i),
  n => Object.assign({}, list(n, i => i)), n => new Proxy(list(n, i => i), {}), n => Object.setPrototypeOf([1, , 3], { 1: 9.5, 5: 4 }), () => null, () => undefined, () => 5, () => ({}), n => list(n, i => [i]),
];
const numbers = [[3, 1, 3], [4, 0, 4], [0, 2, 5], [2.5, 1, 3], ['3', 1, 2], [3, -1, 2], [NaN, 1, 2], [3, .5, 2], [5, '2', 4], [undefined, 1, 1], [4, null, 2], [1, -0, 3], [8, 2, 2], [9, 3, 2], [16, 1, 3], [17, 0, 2], [33, 0, 1], [65, 0, 1], [400, 1, 2]];
const attempt = (f, ...c) => { try { return say(f(...c)); } catch (e) { return e.constructor.name; } };
for (const f of functions) {
  let hash = 0, first = '';
  for (let turn = 0; turn < 2; turn++) for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 32, 33, 40, 63, 64, 65]) for (let k = 0; k < holders.length; k++) {
    const [w, y, h] = numbers[(n + k + turn) % numbers.length], a = attempt(turn ? f : table[f.name + 0], holders[k](n), w, y, h, holders[0](n));
    for (let i = 0; i < a.length; i++) hash = (hash * 31 + a.charCodeAt(i)) | 0;
    if (n === 9 && !turn) first += k + ':' + a.slice(0, 24) + ' ';
  }
  console.log(f.name, hash, first);
}
