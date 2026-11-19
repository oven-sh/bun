// Loops whose arms each use a list or a row of a table; lists and rows of every kind.
// STATISTIC: ListsUsedInEveryArm >= 12
const said = []; let digest = 0, cases = 0;
function keep(text) { cases++; for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 97 === 1) said.push(text.slice(0, 160)); }
function show(x, deep = 0) { if (deep > 3) return "."; try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 14) }, (_, i) => i in x ? show(x[i], deep + 1) : "_").join() + "]#" + x.length : ArrayBuffer.isView(x) ? x.constructor.name + Array.from(x, y => show(y)).join() : typeof x === "object" ? "{" + Object.keys(x).slice(0, 12).map(k => k + show(x[k], deep + 1)).join() + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
class Odd extends Array { set 2(v) { this.seen = v; } get 2() { return 7; } }
const kinds = [
  () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5], () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], () => [1, "a", 2.5, null, undefined, 5, { v: 1 }, 7, -0, NaN],
  () => [1, , 3, , 5, 6, , 8, 9, 10], () => ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], () => new Array(10).fill(0), () => [], () => [1.5, 2.5], () => [1, 2, 3],
  () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), () => Odd.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), () => new Float64Array([1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10]), () => new Int32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), () => new Uint8Array(10),
  () => ({ length: 10, 0: 1, 1: 2, 2: 3 }), () => new Proxy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {}), () => "letters that stand", () => null, () => undefined, () => 5, () => [2147483647, -2147483648, 1e10, 4, 5, 6, 7, 8, 9, 10], () => Array.from({ length: 10 }, (_, i) => -i),
];
const s = "abcabcab", t = ["a", "b", "c", "a", "d"]; let place = 0;
function tried(name, f, o, g, n) { if (place++ % 61) return; let answer; try { answer = show(f(o, g, n, s, t)); } catch (e) { answer = e.constructor.name; } keep(name + " " + n + " " + answer + show(o) + show(g)); }
function both(o, g, n, s, t) { for (let i = 0; i < n; i++) { if (s[i & 7] === t[i % 5]) o[i] = g[i]; else o[i] = i; } return o[1]; }
function chain(o, g, n, s, t) { for (let i = 0; i < n; i++) { if (i % 3 === 0) o[i] = i + 0.5; else if (i % 3 === 1) o[i] = g[i]; else o[i] = o[i] + 1; } return o[2]; }
function reads(o, g, n, s, t) { let a = 0; for (let i = 0; i < n; i++) { if (i & 1) a += o[i]; else a += o[i] * 2; } return a; }
function ternary(o, g, n, s, t) { for (let i = 0; i < n; i++) g[i] = i & 1 ? o[i] : o[n - 1 - i]; return g[1]; }
function skips(o, g, n, s, t) { let a = 0; for (let i = 0; i < n; i++) { if (i & 2) { o[i] = a; continue; } a = o[i] + i; } return a; }
function leaves(o, g, n, s, t) { for (let i = 0; i < n; i++) { if (i === 5) break; if (i & 1) o[i] = 1; else o[i] = 2; } return o[0]; }
function throws(o, g, n, s, t) { for (let i = 0; i < n; i++) { if (i === 99) throw new Error("no"); if (i & 1) o[i] = i; else o[i] = -i; } return o[0]; }
function some(o, g, n, s, t) { for (let i = 0; i < n; i++) { if (i & 1) o[i] = g[i]; } return o[1]; }
function inner(o, g, n, s, t) { let a = 0; for (let i = 0; i < n; i++) { if (i & 1) { for (let j = 0; j < 3; j++) a += o[j]; } else a += o[i]; } return a; }
function chosen(o, g, n, s, t) { for (let i = 0; i < n; i++) { switch (i & 3) { case 0: o[i] = 1; break; case 1: o[i] = 2.5; break; case 2: o[i] = g[i]; break; default: o[i] = o[0]; } } return o[3]; }
function either(o, g, n, s, t) { for (let i = 0; i < n; i++) { (i & 1 && (o[i] = i)) || (o[i] = g[i]); } return o[1]; }
function common(o, g, n, s, t) { for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) { if (s[i & 7] === t[j % 5]) o[i][j] = o[i - 1][j - 1] + 1; else o[i][j] = Math.max(o[i - 1][j], o[i][j - 1]); } return o[1][1]; }
function copied(o, g, n, s, t) { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) o[i][j] = 0; else o[i][j] = g[i][j]; } return o[0][1]; }
function distance(o, g, n, s, t) { for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) { if (i & 1) o[i][j] = Math.min(o[i - 1][j] + 1, o[i][j - 1] + 1); else if (j & 1) o[i][j] = g[i][j] * 2; else o[i][j] = g[i][j] + o[i][j]; } return o[1][2]; }
function counted(o, g, n, s, t) { for (let k = 0; k < n * 4; k++) { const a = (k * 7) % n, b = (k * 3) % n; if (k & 1) o[a][b]++; else o[a][b] += 2; } return o[0][0]; }
function swapped(o, g, n, s, t) { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i < j) { const x = o[i][j]; o[i][j] = o[j][i]; o[j][i] = x; } else o[i][j] = -o[i][j]; } return o[1][0]; }
function shifted(o, g, n, s, t) { for (let i = 0; i < n; i++) { const row = o[i]; for (let j = 0; j < n; j++) { if (j + 1 < n) row[j] = row[j + 1]; else row[j] = 0; } } return o[0][0]; }
for (const f of [both, chain, reads, ternary, skips, leaves, throws, some, inner, chosen, either]) for (const a of kinds) for (const b of kinds) for (const n of [0, 1, 6, 10, 12]) tried(f.name, f, a(), b(), n);
const table = k => Array.from({ length: 10 }, (_, i) => k());
const tables = [...kinds.map(k => () => table(k)), () => { const r = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; return Array.from({ length: 10 }, () => r); }, () => Array.from({ length: 10 }, (_, i) => kinds[i % 5]()), () => Array.from({ length: 10 }, (_, i) => kinds[i & 1]()), () => table(kinds[0]).slice(0, 4), () => { const m = table(kinds[1]); m[1] = m; return m; }, () => null, () => ["ab", "cd", "ef"], () => { const m = table(kinds[1]); m[4] = undefined; return m; }];
for (const f of [common, copied, distance, counted, swapped, shifted]) for (const a of tables) for (const b of tables) for (const n of [0, 2, 6, 10]) tried(f.name, f, a(), b(), n);
console.log(cases, digest); for (const x of said) console.log(x);
