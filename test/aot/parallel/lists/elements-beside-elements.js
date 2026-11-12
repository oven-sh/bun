// Elements of lists that nobody types held against one another in loops.
// STATISTIC: ElementsCheckedAlongsideElements >= 4
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 211 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const one = { valueOf() { calls++; return 2; }, toString() { calls++; return "b"; } }, other = { valueOf() { calls++; return 3; } }, mark = Symbol("m");
const rope = n => "ab".repeat(n) + (cases & 1 ? "c" : "d");
const lists = [
  () => [1, 2, 3, 2, 1, 2, 3, 4], () => [1.5, 2.5, 3.5, 2.5, 1.5, 2, 3, 4], () => [1, 2, 3.5, NaN, NaN, -0, 0, 4], () => [0, -0, 0, 1, 2, 3, 2147483647, -2147483648], () => ["a", "b", "c", "b", "a", "bb", "", "d"], () => [rope(1), rope(2), rope(3), rope(2), rope(1), rope(9), "ab", "abc"], () => [1, "1", 2, "2", null, undefined, true, false], () => [1, , 3, , 1, 2, , 4], () => [undefined, undefined, null, null, 0, "", false, NaN], () => [one, other, one, one, null, mark, 2n, 2], () => [2n, 3n, 2n, 10n ** 20n, 10n ** 20n, 1n, 2n, 4n], () => [], () => new Array(8), () => new Array(8).fill(2), () => Object.freeze([1, 2, 3, 2, 1, 2, 3, 4]), () => { const a = [1, 2, 3, 2, 1, 2, 3, 4]; Object.defineProperty(a, 3, { get() { calls++; return 2.5; }, configurable: true }); return a; }, () => new Float64Array([1, 2, 3, NaN, 1, -0, 3, 4]), () => new Int32Array([1, 2, 3, 2, 1, 2, 3, 4]), () => new Uint8Array([1, 2, 3, 2, 1, 2, 3, 4]), () => new BigInt64Array(8), () => "12321234", () => "abcbabbd", () => rope(4), () => ({ length: 8, 0: 1, 1: 2, 2: 3, 4: 1 }), () => [[1], [1], "x", 1, 1, {}, {}, 4], () => [1e300, 1e-300, 2 ** 53, 2 ** 53 + 2, Infinity, -Infinity, 0.1 + 0.2, 0.3],
];
function count(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++; return n; }
function differ(a, b) { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] !== b[i] ? 1 : 0; return n; }
function loose(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] == b[i]) n++; return n; }
function looseNot(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] != b[i]) n += i; return n; }
function first(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; }
function neighbors(a) { let n = 0; for (let i = 1; i < a.length; i++) if (a[i] === a[i - 1]) n += i; return n; }
function pairs(a, b) { let n = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (a[i] === b[j]) n += i * j; return n; }
function runs(a) { let n = 0; for (let i = 0; i < a.length;) { let j = i; while (j < a.length && a[j] === a[i]) j++; if (j === i) j++; n = n * 3 + j - i; i = j; } return n; }
function ends(a) { for (let i = 0, j = a.length - 1; i < j; i++, j--) if (a[i] !== a[j]) return i; return -1; }
function itself(a) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== a[i]) n++; return n; }
function unique(a) { const out = []; for (let i = 0; i < a.length; i++) { let seen = false; for (let j = 0; j < out.length; j++) if (out[j] === a[i]) { seen = true; break; } if (!seen) out.push(a[i]); } return out; }
function longest(a, b) { const f = []; for (let i = 0; i <= 8; i++) f.push(new Array(9).fill(0)); for (let i = 1; i <= 8; i++) for (let j = 1; j <= 8; j++) { if (a[i - 1] === b[j - 1]) f[i][j] = f[i - 1][j - 1] + 1; else f[i][j] = Math.max(f[i - 1][j], f[i][j - 1]); } return f[8][8]; }
function merge(a, b) { let i = 0, j = 0, n = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { n++; i++; j++; } else if (a[i] < b[j]) i++; else j++; } return n; }
function part(a, b) { let best = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) { let k = 0; while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++; if (k > best) best = k; } return best; }
function beyond(a, b) { let n = 0; for (let i = 0; i < 10; i++) if (a[i] === b[i]) n += i; return n; }
function shifted(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i + 1] === b[i - 1]) n += i; return n; }
function stored(a, b) { let n = 0; for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) n++; else if (Array.isArray(b) && !Object.isFrozen(b) && i === 2) b[5] = "z"; } return n; }
function copied(a, b) { let n = 0; for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) n++; if (Array.isArray(b) && !Object.isFrozen(b)) b[i] = a[i]; } return n + show(b); }
function called(a, b) { let n = 0; for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) n++; else n += one.valueOf(); } return n; }
function kept(a, b) { const out = []; for (let i = 0; i < a.length; i++) out.push(a[i] === b[i]); return out.join(); }
function both(a, b) { let n = 0; for (let i = 1; i < a.length; i++) if (a[i] === b[i] && a[i - 1] === b[i - 1]) n++; return n; }
function under(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[b[i]] === b[i]) n++; return n; }
const forms = [count, differ, loose, looseNot, first, neighbors, pairs, runs, ends, itself, unique, longest, merge, part, beyond, shifted, stored, copied, called, kept, both, under];
function tried(f, a, b) { calls = 0; let answer; try { answer = show(f(a, b)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + calls); }
for (const f of forms) for (const a of lists) for (const b of lists) { const x = a(); tried(f, x, b === a ? x : b()); }
for (const f of forms) for (const [a, b] of [[null, [1]], [[1], undefined], [5, 6], [undefined, null], [{}, {}]]) tried(f, a, b);
// Off an object that nobody types.
const named = (names, values) => { const o = {}; names.split(" ").forEach((n, i) => { o[n] = values[i]; }); return o; };
function countOff(c) { const a = c.one, b = c.two; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++; return n; }
function countIn(c) { let n = 0; for (let i = 0; i < c.one.length; i++) if (c.one[i] === c.two[i]) n++; return n; }
function rowsOff(c) { const g = c.rows; let n = 0; for (let y = 1; y < g.length; y++) for (let x = 1; x < g[y].length; x++) if (g[y][x] === g[y - 1][x] && g[y][x] === g[y][x - 1]) n += x; return n; }
function keyOff(c) { const a = c.one, k = c.key; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === k) n += i; return n; }
for (const f of [countOff, countIn, rowsOff, keyOff]) for (const a of lists) for (const b of lists) for (const k of [2, 2.5, "b", NaN, undefined]) tried(f, named("one two rows key", [a(), b(), [a(), b(), a()], k]));
console.log(cases, digest); for (const x of said) console.log(x);
