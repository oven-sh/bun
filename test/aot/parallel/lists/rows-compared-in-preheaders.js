// Elements of rows of tables that nobody types, held against one another and against values from in front.
// STATISTIC: ArrayRowsHoisted >= 25
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 307 === 1) said.push(text.slice(0, 170)); }
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; return value; }, set(v) { calls += 100; value = v; }, enumerable: true, configurable: true });
const counting = v => ({ valueOf() { calls++; return v; } });
const one = {}, sign = Symbol("s");
const values = [0, -0, 1, 2, 0.5, 1.5, NaN, Infinity, 2147483647, "1", "a", "", undefined, null, true, false, 2n, sign, one, counting(1), [1]];
const row = [() => [0, 1, 2, 3, 2, 1], () => [0.5, 1.5, 0.5, 1.5, 2, 2], () => [NaN, -0, 0, Infinity, NaN, 1], () => [0, , 2, , 2, 1], () => [, 1.5, 1.5, , , 2], () => ["a", "b", "a", "1", "1", ""], () => [1, "1", true, null, undefined, 2n], () => [one, one, {}, sign, sign, counting(1)], () => [], () => [1], () => new Float64Array([0.5, 1.5, 0.5, NaN, 2, 2]), () => new Uint8Array([0, 1, 2, 2, 1, 0]), () => "aabbc1", () => Object.freeze([0, 1, 1, 2, 2, 1]), () => got([0, 1, 1, 2, 2, 1], 2, 1), () => new (class extends Array {})(0, 1, 1, 2, 2, 1), () => ({ length: 6, 0: 1, 1: 1, 4: 2 }), () => [2147483647, 2147483648, 2147483647, -2147483648, 1, 1], () => new Proxy([0, 1, 1, 2, 2, 1], { get(t, k) { calls++; return t[k]; } }), () => undefined, () => null, () => 5];
function beside(g) { let n = 0; for (let i = 0; i < g.length; i++) for (let j = 0; j + 1 < g[i].length; j++) if (g[i][j] === g[i][j + 1]) n++; return n; }
function above(g) { let n = 0; for (let y = 1; y < g.length; y++) for (let x = 1; x < g[y].length; x++) if (g[y][x] === g[y - 1][x] && g[y][x] === g[y][x - 1]) n++; return n; }
function corner(g) { let n = 0; for (let i = 1; i < g.length; i++) for (let j = 1; j < g[i].length; j++) if (g[i][j] !== g[i - 1][j - 1]) n += i + j; return n; }
function same(g, k) { let n = 0; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === k) n += y * 10 + x; return n; }
function other(g, k) { let n = 0; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] !== k) n += y * 10 + x; return n; }
function loose(g, k) { let n = 0; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] == k) n += y * 10 + x; return n; }
function zero(g) { let n = 0; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] !== 0) n += y * 10 + x; return n; }
function written(g) { let n = 0; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === "a" || g[y][x] === 1) n += y * 10 + x; return n; }
function list(g, k) { let n = 0; const a = g[0]; for (let i = 0; i < a.length; i++) if (a[i] === k) n += i + 1; return n; }
function listAgainst(g) { let n = 0; const a = g[0], b = g[1]; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n += i + 1; return n; }
function runs(g) { let n = 0; for (let y = 0; y < g.length; y++) { let x = 0; while (x < g[y].length) { let e = x; while (e < g[y].length && g[y][e] === g[y][x]) e++; n += e - x; x = e > x ? e : x + 1; } } return n; }
function sums(g, k) { let s = 0; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) { if (g[y][x] === k) s += g[y][x]; else s -= 1; } return s; }
function stores(g, k) { for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === k) g[y][x] = 9; return g.map(r => r && r.length ? Array.from(r, String).join() : 0).join(";"); }
function swaps(g, k) { let n = 0; for (let y = 0; y + 1 < g.length; y++) for (let x = 0; x < g[y].length; x++) { if (g[y][x] === g[y + 1][x]) n++; if (x === 2) { const t = g[y]; g[y] = g[y + 1]; g[y + 1] = t; } } return n; }
function ofRows(g, k) { let n = 0; for (const r of g) for (let x = 0; x < r.length; x++) if (r[x] === k) n += x + 1; return n; }
function named(g, k) { const c = JSON.parse('{"z":1}'); c.cells = g; c.mark = k; let n = 0; for (let y = 0; y < c.cells.length; y++) for (let x = 0; x < c.cells[y].length; x++) if (c.cells[y][x] === c.mark) n += x + 1; return n; }
function tried(f, g, k) { calls = 0; let answer; try { answer = String(f(g, k)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + " " + calls); }
for (const f of [beside, above, corner, zero, written, listAgainst, runs, swaps]) for (const a of row) for (const b of row) tried(f, [a(), b(), a()]);
for (const f of [same, other, loose, list, sums, stores, ofRows, named]) for (const a of row) for (const b of row) for (let i = 0; i < 3; i++) tried(f, [a(), b()], values[(cases * 7 + i * 5) % values.length]);
for (const f of [same, other, loose, stores]) for (const k of values) for (const a of row) tried(f, [a(), [0, 1, 2], a(), [0.5, 1.5]], k);
console.log(cases, digest); for (const x of said) console.log(x);
