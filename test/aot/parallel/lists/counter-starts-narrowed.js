// Loops whose counter starts from a value nobody knows and that name that value again.
// STATISTIC: CounterStartsNarrowed >= 10
const said = []; let digest = 0, cases = 0, calls = 0;
function keep(text) { cases++; for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 41 === 1) said.push(text.slice(0, 150)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 12) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
function g(w, j) { return typeof w === "number" ? w * 10 + j : 1; }
const lists = [() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], () => [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(x => x + 0.5), () => new Array(12).fill(0), () => ["a", "b", "c"], () => [1, , 3, , 5], () => [], () => new Float64Array(12)];
const starts = [() => 0, () => 1, () => 3, () => 11, () => 12, () => -1, () => -0, () => 2.5, () => -2.5, () => NaN, () => Infinity, () => 2147483647, () => 2147483648, () => -2147483648, () => "2", () => "x", () => "", () => null, () => undefined, () => true, () => 2n, () => [3], () => ({ valueOf() { calls++; return 2; } }), () => new Number(4), () => new Date(1), () => Symbol("w"), () => ({ valueOf() { throw new RangeError("no"); } })];
let place = 0;
function tried(f, list, w, n) { if (place++ % 3) return; calls = 0; let answer; try { answer = show(f(list, w, n)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + n + " " + answer + show(list) + calls); }
function coins(f, w, n) { for (let j = w; j <= n; j++) f[j] += f[j - w]; return f[n]; }
function sack(f, w, n) { for (let j = n; j >= w; j--) f[j] = Math.max(f[j], f[j - w] + 2); return f[n]; }
function named(f, w, n) { let s = ""; for (let j = w; j < n; j++) s += typeof w + Object.is(w, -0) + w + (j - w) + ";"; return s; }
function added(f, w, n) { let s = 0; for (let j = w; j < n; j++) s += f[j] + w; return s; }
function product(f, w, n) { for (let j = w; j < n; j++) f[j] = j * w; return f[2]; }
function kept(f, w, n) { const out = []; for (let j = w; j < n; j++) out.push(w, j); return out; }
function compared(f, w, n) { let s = 0; for (let j = w; j < n; j++) { if (j === w) s++; if (f[j] > w) s += 2; } return s; }
function changed(f, w, n) { let v = w, s = 0; for (let j = v; j < n; j++) { s += f[j - v] + v; v = w; } return s; }
function nested(f, w, n) { let s = 0; for (let i = 0; i < 3; i++) for (let j = w; j < n; j++) s += f[j - w] + i; return s; }
function called(f, w, n) { let s = 0; for (let j = w; j < n; j++) s += g(w, j); return s; }
function stepped(f, w, n) { let s = 0; for (let j = w; j < n; j += 2) s += f[j] - w; return s; }
function bits(f, w, n) { let s = 0; for (let j = w; j < n; j++) s = (s ^ w) + (j | w); return s; }
for (const f of [coins, sack, named, added, product, kept, compared, changed, nested, called, stepped, bits]) for (const a of lists) for (const w of starts) for (const n of [0, 5, 11]) if (typeof w() !== "number" || Math.abs(w()) < 100 || w() > 100 || w() !== w()) tried(f, a(), w(), n);
console.log(cases, digest); for (const x of said) console.log(x);
