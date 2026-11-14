// Loops that find their lists and constants by name off objects that nobody types, and store into what they find.
// STATISTIC: SiteCachedReadsHoisted >= 30
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 211 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const lists = [
  () => [1, 2, 3, 4, 5, 6], () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5], () => [1, 2.5, 3, NaN, -0, 6], () => [1, , 3, , 5, 6], () => ["a", "b", "c", "d", "e", "f"], () => [1, "b", 3, null, undefined, {}], () => [], () => new Array(6), () => new Array(6).fill(0), () => [2147483647, -2147483648, 1, 1, 1, 1], () => [1e21, -1e21, 1, 1, 1, 1], () => Object.freeze([1, 2, 3, 4, 5, 6]), () => Object.seal([1, 2, 3, 4, 5, 6]), () => { const a = [1, 2, 3, 4, 5, 6]; Object.defineProperty(a, 2, { get() { calls++; return 9; }, set(v) { calls += 10; }, configurable: true }); return a; }, () => new Float64Array([1, 2, 3, 4, 5, 6]), () => new Int32Array([1, 2, 3, 4, 5, 6]), () => new Uint8Array([1, 2, 3, 250, 5, 6]), () => ({ length: 6, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }), () => "123456", () => new Proxy([1, 2, 3, 4, 5, 6], { get(t, k) { calls++; return t[k]; }, set(t, k, v) { calls++; t[k] = v; return true; } }), () => { const a = [1, 2, 3, 4, 5, 6]; a.length = 8; return a; },
];
const constants = [() => 3, () => 2.5, () => -0, () => NaN, () => 2147483647, () => "t", () => undefined, () => null, () => ({ valueOf() { calls++; return 2; } }), () => true, () => 2n];
const named = (names, values, o = {}) => { names.split(" ").forEach((n, i) => { o[n] = values[i]; }); return o; };
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; return value; }, set(v) { calls += 100; value = v; }, enumerable: true, configurable: true });
const shapes = [
  (xs, ys, k) => named("xs ys k", [xs, ys, k]), (xs, ys, k) => named("ys k xs", [ys, k, xs], JSON.parse('{"a":1,"b":2}')), (xs, ys, k) => got(named("xs k", [xs, k]), "ys", ys), (xs, ys, k) => got(got(named("ys", [ys]), "xs", xs), "k", k), (xs, ys, k) => Object.create(named("xs ys k", [xs, ys, k])), (xs, ys, k) => new Proxy(named("xs ys k", [xs, ys, k]), { get(t, n) { calls++; return t[n]; } }), (xs, ys, k) => named("k ys xs", [k, ys, xs], named("z" + calls, [1])), (xs, ys, k) => named("xs ys k", [xs, xs, k]),
];
function moved(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i] = c.xs[i]; return c.ys; }
function added(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i] = c.xs[i] + c.k; return c.ys; }
function scaled(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i] = c.xs[i] * c.k; return c.ys; }
function stepped(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i] += c.k; return c.ys; }
function counted(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i]++; return c.ys; }
function rest(c) { for (let i = 0; i < c.ys.length; i++) c.ys[i] = (c.ys[i] + c.k) % 97; return c.ys; }
function under(c) { for (let i = 0; i < c.xs.length && i < 20; i++) c.ys[c.xs[i]] = i; return c.ys; }
function greatest(c) { for (let i = 1; i < c.xs.length; i++) c.ys[i] = Math.max(c.ys[i - 1], c.xs[i] + c.k); return c.ys; }
function cut(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i] = Math.min(c.k, Math.max(2, c.xs[i])); return c.ys; }
function filled(c) { for (let i = 0; i < c.xs.length; i++) c.ys[i] = c.k; return c.ys; }
function twice(c) { for (let i = 0; i < c.xs.length; i++) { c.ys[i] = c.xs[i]; c.ys[i] = c.ys[i] + c.k; } return c.ys; }
function some(c) { for (let i = 0; i < c.xs.length; i++) if (c.xs[i] > c.k) c.ys[i] = c.xs[i]; return c.ys; }
function either(c) { for (let i = 0; i < c.xs.length; i++) if (c.k > i) c.ys[i] = c.xs[i]; else c.ys[i] = Math.max(c.ys[i], c.xs[i] - c.k); return c.ys; }
function beyond(c) { for (let i = 0; i < c.xs.length + 2 && i < 20; i++) c.ys[i] = i * 2; return c.ys; }
function replaced(c) { let s = 0; for (let i = 0; i < c.xs.length; i++) { c.ys[i] = i; s += c.xs[i]; if (i === 2) c.xs = c.ys; } return s; }
function shifted(c) { let s = 0; for (let i = 0; i < c.xs.length; i++) { s += c.k * i; if (i === 3) c.k = 7; } return s; }
function inner(c) { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < c.xs.length; j++) { c.ys[j] = c.xs[j] + i; s += c.ys[j]; } return s; }
const forms = [moved, added, scaled, stepped, counted, rest, under, greatest, cut, filled, twice, some, either, beyond, replaced, shifted, inner];
let place = 0;
function tried(f, c, ys) { calls = 0; let answer; try { answer = show(f(c)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + show(ys) + calls); }
for (const f of forms) for (const xs of lists) for (const y of lists) for (const k of constants.slice(place % 7, place % 7 + 4)) { const at = place++ % 9; if (at >= shapes.length) continue; const ys = y(); tried(f, shapes[at](xs(), ys, k()), ys); if (place % 4 === 0) { const zs = y(); tried(f, shapes[0](xs(), zs, k()), zs); } }
// A table and objects that nobody types.
const items = JSON.parse('[{"w":3,"v":4},{"w":5,"v":6.5},{"w":2,"v":3},{"w":1,"v":-0},{"w":4,"v":1}]');
const odd = [named("w v", ["2", 3]), got(named("w", [1]), "v", 5), named("w v", [1.5, 2]), named("w v", [-1, 2]), named("w v", [NaN, 1]), named("w v", [0, "x"]), named("w v", [2, null]), named("w v", [{ valueOf() { calls++; return 2; } }, 1])];
const tables = [n => Array.from({ length: n + 1 }, () => new Array(9).fill(0)), n => { const f = []; for (let i = 0; i <= n; i++) f.push(new Array(9).fill(0.5)); return f; }, n => Array.from({ length: n + 1 }, (_, i) => i & 1 ? new Float64Array(9) : new Array(9).fill(1)), n => { const r = new Array(9).fill(0); return Array.from({ length: n + 1 }, () => r); }, n => Array.from({ length: n + 1 }, (_, i) => i === 2 ? Object.freeze(new Array(9).fill(0)) : new Array(9).fill(0)), n => Array.from({ length: n + 1 }, () => new Array(9)), n => Array.from({ length: n + 1 }, () => ["a", 1, 2, 3, 4, 5, 6, 7, 8])];
function sackIf(f, it, n) { for (let i = 1; i <= n; i++) { const x = it[i - 1]; for (let j = 0; j <= 8; j++) { if (x.w > j) f[i][j] = f[i - 1][j]; else f[i][j] = Math.max(f[i - 1][j], f[i - 1][j - x.w] + x.v); } } return f; }
function sackMove(f, it, n) { for (let i = 1; i <= n; i++) for (let j = 0; j <= 8; j++) { f[i][j] = f[i - 1][j]; if (it[i - 1].w <= j) f[i][j] = Math.max(f[i][j], f[i - 1][j - it[i - 1].w] + it[i - 1].v); } return f; }
function sackOne(f, it, n) { for (let i = 1; i <= n; i++) for (let j = 1; j <= 8; j++) { const x = it[i - 1]; f[i][j] = x.w <= j ? Math.max(f[i - 1][j], f[i - 1][j - x.w] + x.v) : f[i - 1][j]; } return f; }
function sackParts(f, it, n) { for (let i = 1; i <= n; i++) { const { w, v } = it[i - 1]; for (let j = 0; j <= 8; j++) { f[i][j] = f[i - 1][j]; if (w <= j && f[i - 1][j - w] + v > f[i][j]) f[i][j] = f[i - 1][j - w] + v; } } return f; }
function sackRow(f, it, n) { const g = f[0]; for (let i = 0; i < n; i++) { const x = it[i]; for (let j = 8; j >= x.w; j--) g[j] = Math.max(g[j], g[j - x.w] + x.v); } return g; }
function movedRows(f, it, n) { for (let i = 1; i <= n; i++) for (let j = 0; j < 9; j++) { f[i][j] = f[i - 1][j]; f[0][j] += it[i - 1].v; } return f; }
function copiedRows(f, it, n) { for (let i = 1; i <= n; i++) for (let j = 0; j < 8; j++) { f[i][j] = f[i - 1][j + 1]; f[i][j + 1] = Math.max(f[i][j], j); } return f; }
for (const f of [sackIf, sackMove, sackOne, sackParts, sackRow, movedRows, copiedRows]) for (const t of tables) for (let k = 0; k <= odd.length; k++) { const it = items.slice(); if (k) it[k % 5] = odd[k - 1]; for (const n of [5, 3]) { calls = 0; const g = t(5); let answer; try { answer = f(g, it, n).map(show).join(); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + g.map(show).join() + calls); } }
console.log(cases, digest); for (const x of said) console.log(x);
