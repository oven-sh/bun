// Loops that store unknown values into lists that they read numbers off.
// STATISTIC: ArraysConvertedToDoubleStorage >= 1
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 307 === 1) said.push(text.slice(0, 170)); }
function show(x, d = 0) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : d > 2 ? "..." : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 9) }, (_, i) => i in x ? show(x[i], d + 1) : "_").join() + "]" + x.length + (x.length > 9 ? show(x[x.length - 1], 2) + x.reduce((a, b) => typeof b === "number" ? a + b : a + 1, 0) : "") + Object.keys(x).length : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
function g1(a, b) { return a < 3 ? b : a; }
function clamp(y, z, v, c, n) { for (let i = 0; i < y.length; i++) if (y[i] < v) y[i] = v; return show([y, z, c.s]); }
function between(y, z, v, c, n) { for (let i = 0; i < y.length; i++) if (y[i] < v) y[i] = v; else if (y[i] > c.k) y[i] = c.k; return show([y, z, c.s]); }
function replace(y, z, v, c, n) { for (let i = 0; i < y.length; i++) if (y[i] === 2) y[i] = v; return show([y, z, c.s]); }
function given(y, z, v, c, n) { for (let i = 0; i < y.length; i++) y[i] = g1(y[i], v); return show([y, z, c.s]); }
function doubled(y, z, v, c, n) { for (let i = 0; i < y.length; i++) { y[i] = y[i] * 2; if (y[i] > 5) y[i] = c.k; } return show([y, z, c.s]); }
function swap(y, z, v, c, n) { for (let i = 0; i < y.length; i++) { const t = y[i]; y[i] = z[i]; z[i] = t; } return show([y, z, c.s]); }
function least(y, z, v, c, n) { for (let i = 0; i < y.length; i++) y[i] = y[i] < v ? y[i] : v; return show([y, z, c.s]); }
function mixed(y, z, v, c, n) { let s = 0; for (let i = 0; i < y.length; i++) { s += y[i]; y[i] = i & 1 ? v : c.k; } c.s = s; return show([y, z, c.s]); }
function other(y, z, v, c, n) { for (let i = 0; i < y.length; i++) if (z[i] > 2) y[i] = v; return show([y, z, c.s]); }
function both(y, z, v, c, n) { for (let i = 0; i < y.length; i++) if (z[i] > y[i]) y[i] = v; else z[i] = v; return show([y, z, c.s]); }
function two(y, z, v, c, n) { let s = 0; for (let i = 0; i < y.length; i++) { s += y[i] - z[i]; y[i] = v; z[i] = c.k; } c.s = s; return show([y, z, c.s]); }
function twice(y, z, v, c, n) { for (let i = 0; i < y.length; i++) { if (y[i] < 3) y[i] = v; if (y[i] > 1) y[i] = c.k; } return show([y, z, c.s]); }
function before(y, z, v, c, n) { for (let i = 1; i < y.length; i++) if (y[i] > y[i - 1]) y[i - 1] = v; return show([y, z, c.s]); }
function nest(y, z, v, c, n) { for (let j = 0; j < 2; j++) for (let i = 0; i < y.length; i++) if (y[i] < j + 2) y[i] = v; return show([y, z, c.s]); }
function whiles(y, z, v, c, n) { let i = 0; while (i < y.length) { if (y[i] < 3) y[i] = v; i++; } return show([y, z, c.s]); }
function summed(y, z, v, c, n) { let s = 0; for (let i = 0; i < y.length; i++) { s += y[i]; if (s > 4) y[i] = v; } c.s = s; return show([y, z, c.s]); }
function counted(y, z, v, c, n) { const t = new Array(8).fill(0); for (let i = 0; i < y.length; i++) { t[y[i] & 7]++; y[i] = v; } c.s = t; return show([y, z, c.s]); }
function getter(y, z, v, c, n) { for (let i = 0; i < y.length; i++) if (y[i] < 4) y[i] = c.g; return show([y, z, c.s]); }
function rows(y, z, v, c, n) { const g = [y, z]; for (let j = 0; j < g.length; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] < 2) g[j][i] = v; return show([y, z, c.s]); }
const lists = [() => [1, 2, 3, 4, 5, 6, 7, 8], () => [0.5, 1.5, 2.5, 3.5, 4.5], () => ["a", "b", "c", "d"], () => [1, , 3, 4], () => [{}, 1, null], () => [], () => JSON.parse("[1,2,3,4,5,6,7]"), () => JSON.parse("[0.5,1.5,2.5]"), () => new Array(6), () => new Array(6).fill(0), () => new Float64Array(6), () => new Int32Array(6), () => ({ length: 4, 0: 1 }), () => Object.freeze([1, 2, 3]), () => [-0, NaN, 1.5]];
const values = [() => 3, () => 0.5, () => -0, () => NaN, () => Infinity, () => "t", () => undefined, () => null, () => true, () => ({}), () => 2147483648, () => -7, () => 6n, () => Symbol.iterator, () => [1]];
const forms = { clamp, between, replace, given, doubled, swap, least, mixed, other, both, two, twice, before, nest, whiles, summed, counted, getter, rows };
for (const name in forms) for (let l = 0; l < lists.length; l++) for (let v = 0; v < values.length; v++) {
  calls = 0; const y = lists[l](), z = lists[(l * 7 + v) % lists.length](); let answer;
  const c = { s: 0, k: values[(v + l) % values.length](), d: { k: values[v]() }, get g() { calls++; return calls & 1 ? values[v]() : 1.5; } };
  for (let again = 0; again < 2; again++) { try { answer = forms[name](y, again ? y : z, values[v](), c, 4 + again); } catch (e) { answer = e && e.constructor ? e.constructor.name : typeof e; } keep(name + " " + l + " " + v + " " + answer + calls); }
}
console.log(cases, digest); for (const x of said) console.log(x);
