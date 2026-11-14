// Elements that are cut to whole numbers, in lists of whole numbers, of fractions and of anything.
const said = []; let digest = 0, cases = 0, calls = 0;
function keep(text) { cases++; for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 41 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 14) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const counting = v => ({ valueOf() { calls++; return v; } });
const lists = [() => [1, 2, 3, 4, 5, 6], () => [1.5, 2.25, -3.75, 4, 5.5, 6], () => [1, NaN, -0, Infinity, -Infinity, 4294967297.5], () => [1, , 3, , 5, 6], () => ["1", "2.5", "x", "", " 4 ", "0x10"], () => [null, undefined, true, false, [], [7]], () => [counting(2.5), 1, counting("3"), 2, {}, 5], () => [1n, 2, 3, 4, 5, 6], () => [], () => new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5]), () => new Int8Array(6), () => [2147483647, 2147483648, -2147483649, 1e20, -1e-9, 0.9]];
function sums(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] | 0; return s; }
function twice(x) { let s = 0; for (let i = 0; i < x.length; i++) s += ~~x[i] + x[i]; return s; }
function shifted(x) { let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] >> 0) * 2; return s; }
function beside(x) { let s = 0; for (let i = 0; i + 1 < x.length; i++) s += (x[i] | 0) + x[i + 1]; return s; }
function stored(x) { const y = []; for (let i = 0; i < x.length; i++) y[i] = x[i] | 0; return y; }
function counts(x) { const t = new Array(8).fill(0); for (let i = 0; i < x.length; i++) t[x[i] | 0]++; return t; }
function sack(g) { const f = new Array(9).fill(0); for (let k = 0; k < g.length; k++) { const w = g[k][0] | 0, v = g[k][1]; for (let c = 8; c >= w && c >= 0; c--) f[c] = Math.max(f[c], f[c - w] + v); } return f; }
function rows(g) { let s = 0; for (let k = 0; k < g.length; k++) s += (g[k][0] | 0) + g[k][1]; return s; }
for (const f of [sums, twice, shifted, beside, stored, counts]) for (const x of lists) { calls = 0; let answer; try { answer = show(f(x())); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + " " + calls); }
for (const f of [sack, rows]) for (const a of lists) for (const b of lists) { calls = 0; let answer; try { answer = show(f([[2, 3], a(), [1, 0.5], b(), [3, 4]])); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + " " + calls); }
console.log(cases, digest); for (const x of said) console.log(x);
