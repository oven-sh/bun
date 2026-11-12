// Loops that find the keys of a list by name off objects that nobody types: relaxations of edges, counts, moves.
// STATISTIC: ArraysConvertedToDoubleStorage >= 12
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 211 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 14) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]" + x.length + Object.keys(x).filter(k => !(k >= 0)) : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const named = (names, values, o = {}) => { names.split(" ").forEach((n, i) => { o[n] = values[i]; }); return o; };
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; return value; }, set(v) { calls += 100; value = v; }, enumerable: true, configurable: true });
const counting = v => ({ valueOf() { calls++; return v; }, toString() { calls += 10; return String(v); } });
const fails = { valueOf() { calls++; throw new RangeError("no"); }, toString() { throw new RangeError("no"); } };
const edge = (from, to, cost) => named("from to cost", [from, to, cost]);
const whole = JSON.parse('[{"from":0,"to":1,"cost":4},{"from":0,"to":2,"cost":1},{"from":2,"to":1,"cost":2},{"from":1,"to":3,"cost":5},{"from":3,"to":4,"cost":3}]');
const fractions = JSON.parse('[{"from":0,"to":1,"cost":4.5},{"from":0,"to":2,"cost":1.25},{"from":2,"to":1,"cost":2},{"from":1,"to":3,"cost":5},{"from":3,"to":4,"cost":3.5}]');
const odd = [edge("1", 2, 1), edge(1, "2", 1), edge(1.5, 2, 1), edge(1, 2.5, 1), edge(-1, 2, 1), edge(1, -1, 1), edge(NaN, 2, 1), edge(1, NaN, 1), edge(-0, 2, 1), edge(1, -0, 1), edge(9, 2, 1), edge(1, 5, 1), edge(1, 9, 1), edge(4294967295, 2, 1), edge(1, 4294967296, 1), edge(undefined, 2, 1), edge(1, undefined, 1), edge(null, null, 1), edge(counting(1), 2, 1), edge(1, counting(2), 1), edge(fails, 2, 1), edge("length", 2, 1), edge(1, "length", 1), edge(true, false, 1), edge(1n, 2n, 1), edge(1, 2, "x"), edge(1, 2, NaN), edge(1, 2, -0), edge(1, 2, null), edge(1, 2, undefined), edge(1, 2, 1n), edge(1, 2, counting(1)), edge(1, 2, fails), edge(1, 2, Infinity), edge(1, 2, -Infinity), edge(1, 2, 2147483647), edge(1, 2, Symbol.iterator), named("to from cost", [1, 2, 1]), named("from to", [1, 2]), got(edge(0, 2, 1), "from", 1), got(edge(1, 0, 1), "to", 2), got(edge(1, 2, 0), "cost", 1), Object.create(edge(1, 2, 1)), new Proxy(edge(1, 2, 1), {}), null, undefined, 5, "from", [1, 2, 3]];
const tables = [() => [0, 1e9, 1e9, 1e9, 1e9], () => new Array(5).fill(1e9), () => [0, Infinity, Infinity, Infinity, Infinity], () => [0.5, 1e9, 1e9, 1e9, 1e9], () => [0, , 5, , 7], () => [0, "x", 5, null, undefined], () => new Int32Array(5), () => new Float64Array([0, 9, 9, 9, 9]), () => [0, NaN, -0, 9, 9], () => Object.freeze([0, 9, 9, 9, 9]), () => got([0, 9, 9, 9, 9], 2, 4), () => { const d = [0, 9, 9, 9, 9]; d.name = 1; return d; }, () => new (class extends Array {})(0, 9, 9, 9, 9), () => [], () => ({ 0: 0, 1: 9, 2: 9, 3: 9, 4: 9, length: 5 }), () => new Proxy([0, 9, 9, 9, 9], { get(t, k) { calls++; return t[k]; }, set(t, k, v) { calls++; t[k] = v; return true; } }), () => "01234", () => [2147483647, 2147483647, -2147483648, 0, 1]];
function relaxOf(d, e) { for (let r = 0; r < 3; r++) for (const x of e) if (d[x.from] + x.cost < d[x.to]) d[x.to] = d[x.from] + x.cost; return d; }
function relaxAt(d, e) { for (let r = 0; r < 3; r++) for (let k = 0; k < e.length; k++) { const x = e[k]; if (d[x.from] + x.cost < d[x.to]) d[x.to] = d[x.from] + x.cost; } return d; }
function relaxNamed(d, e) { const c = named("edges", [e]); for (let k = 0; k < c.edges.length; k++) { const x = c.edges[k]; if (d[x.from] + x.cost < d[x.to]) d[x.to] = d[x.from] + x.cost; } return d; }
function relaxParts(d, e) { for (let k = 0; k < e.length; k++) { const { from, to, cost } = e[k]; const t = d[from] + cost; if (t < d[to]) d[to] = t; } return d; }
function relaxChanged(d, e) { let n = 0; for (let r = 0; r < 4; r++) { let changed = false; for (const x of e) if (d[x.from] + x.cost < d[x.to]) { d[x.to] = d[x.from] + x.cost; changed = true; n++; } if (!changed) break; } return n; }
function counts(d, e) { for (const x of e) d[x.to]++; return d; }
function sums(d, e) { for (let k = 0; k < e.length; k++) d[e[k].to] += e[k].cost; return d; }
function moves(d, e) { for (let k = 0; k < e.length; k++) d[e[k].to] = d[e[k].from]; return d; }
function marks(d, e) { let s = 0; for (const x of e) { d[x.to] = 1; s += d[x.from] * 2; } return s; }
function reads(d, e) { let s = 0; for (const x of e) s += d[x.from] * x.cost; return s; }
function around(d, e) { let s = 0; for (let k = 0; k < e.length; k++) s += d[k + e[k].from] + d[k - e[k].to]; return s; }
function local(d, e) { const f = new Array(5).fill(0); for (const x of e) f[x.to] = Math.max(f[x.from] + x.cost, f[x.to]); return f; }
function localWhole(d, e) { const f = [0, 0, 0, 0, 0]; for (const x of e) f[x.to] = (f[x.from] + 1) | 0; return f; }
function swaps(d, e) { for (const x of e) { const t = d[x.from]; d[x.from] = d[x.to]; d[x.to] = t; } return d; }
function grows(d, e) { const f = []; for (const x of e) f[x.to] = x.from; return f; }
function texts(d, e) { let s = ""; for (const x of e) s += d[x.from] + x.cost; return s; }
for (const f of [relaxOf, relaxAt, relaxNamed, relaxParts, relaxChanged, counts, sums, moves, marks, reads, around, local, localWhole, swaps, grows, texts]) for (const t of tables) for (let k = 0; k <= odd.length + 1; k++) { const e = (k & 1 ? whole : fractions).slice(); if (k > 1) e[k % 5] = odd[k - 2]; calls = 0; const d = t(); let answer; try { answer = show(f(d, e)); } catch (x) { answer = x.constructor.name; } keep(f.name + " " + answer + show(d) + calls); }
// Lists that the function makes.
const fills = [0, 1e9, Infinity, 0.5, NaN, -0, "x", null, undefined, 2147483647, true, 3n];
function madeOf(v, e) { const d = new Array(5).fill(v); d[0] = 0; for (let r = 0; r < 3; r++) for (const x of e) if (d[x.from] + x.cost < d[x.to]) d[x.to] = d[x.from] + x.cost; return d; }
function madeAt(v, e) { const c = named("edges n", [e, 5]), d = new Array(c.n).fill(v); d[0] = 0; for (let r = 0; r < c.n; r++) for (let k = 0; k < c.edges.length; k++) { const x = c.edges[k]; if (d[x.from] + x.cost < d[x.to]) d[x.to] = d[x.from] + x.cost; } return d; }
function madeParts(v, e) { const c = named("edges n", [e, 5]), d = new Array(c.n).fill(v); d[0] = 0; for (let k = 0; k < c.edges.length; k++) { const { from, to, cost } = c.edges[k]; const t = d[from] + cost; if (t < d[to]) d[to] = t; } return d; }
function madeChanged(v, e) { const d = new Array(5).fill(v); d[0] = 0; let n = 0; for (let r = 0; r < 4; r++) { let changed = false; for (const x of e) if (d[x.from] + x.cost < d[x.to]) { d[x.to] = d[x.from] + x.cost; changed = true; n++; } if (!changed) break; } d.push(n); return d; }
function madeCounts(v, e) { const d = new Array(5).fill(v); for (const x of e) d[x.to]++; return d; }
function madeSums(v, e) { const d = new Array(5).fill(v), c = named("edges", [e]); for (let k = 0; k < c.edges.length; k++) d[c.edges[k].to] += c.edges[k].cost; return d; }
function madeMoves(v, e) { const d = [0, v, v, v, v], c = named("edges", [e]); let s = 0; for (let k = 0; k < c.edges.length; k++) { const x = c.edges[k]; d[x.to] = d[x.from]; s += Math.max(d[x.to], 1) + x.cost; } d.push(s); return d; }
function madeMost(v, e) { const d = new Array(5).fill(v); for (const x of e) d[x.to] = Math.max(d[x.to], d[x.from] + x.cost, x.cost); return d; }
function madeSwaps(v, e) { const d = [5, 4, 3, 2, 1]; let s = 0; for (const x of e) { const t = d[x.from]; d[x.from] = d[x.to]; d[x.to] = t; if (s < 9) s += x.cost * 2; } d.push(s, v); return d; }
function madeGrows(v, e) { const d = []; for (const x of e) d[x.to] = x.from * 2; d.push(v); return d; }
function madeNear(v, e) { const d = [1, 2, 3, 4, 5, 6, 7, 8]; let s = 0; for (let k = 0; k < e.length; k++) { s += d[k + e[k].from] * 2; d[k + 1] = Math.min(d[k], d[k - e[k].to]) + 1; } d.push(s, v); return d; }
for (const f of [madeOf, madeAt, madeParts, madeChanged, madeCounts, madeSums, madeMoves, madeMost, madeSwaps, madeGrows, madeNear]) for (const v of fills) for (let k = 0; k <= odd.length + 1; k++) { const e = (k & 1 ? whole : fractions).slice(); if (k > 1) e[k % 5] = odd[k - 2]; calls = 0; let answer; try { answer = show(f(v, e)); } catch (x) { answer = x.constructor.name; } keep(f.name + " " + answer + calls); }
// Counters that start at what nobody knows.
const starts = [0, 1, 2, 5, 9, 12, -1, -0, 1.5, NaN, Infinity, -3, "3", "x", "", true, null, undefined, [2], counting(3), fails, 4n, 2147483647, -2.5, 1e20, {}, Symbol.iterator, got({}, "valueOf", () => 2)];
const makers = [() => new Array(13).fill(0), () => new Array(13).fill(1), () => new Array(13).fill(0.5), () => new Array(13).fill(Infinity), () => [1, , 3, , 5, 6, 7, 8, 9, 10, 11, 12, 13], () => Array.from("abcdefghijklm"), () => new Float64Array(13).fill(1), () => [1, 2, 3, NaN, -0, 6, 7, 8, 9, 10, 11, 12, 13]];
const limit = f => f.length > 40 ? f.slice(0, 40) : f;
function ways(w, m) { const f = m(); f[0] = 1; for (const x of w) for (let j = x; j <= 12; j++) f[j] += f[j - x]; return limit(f); }
function fewest(w, m) { const f = m(); f[0] = 0; for (const x of w) for (let j = x; j <= 12; j++) if (f[j - x] + 1 < f[j]) f[j] = f[j - x] + 1; return limit(f); }
function lists(w, m) { const f = m(); for (let k = 0; k < w.length; k++) for (let j = w[k]; j <= 12; j++) f[j] = f[j] + f[j - w[k]]; return limit(f); }
function madeWays(w, m) { const f = new Array(13).fill(0); f[0] = 1; for (const x of w) for (let j = x; j <= 12; j++) f[j] += f[j - x]; f.push(m()[0]); return f; }
function madeFewest(w, m) { const f = new Array(13).fill(1e9); f[0] = 0; for (const x of w) for (let j = x; j <= 12; j++) if (f[j - x] + 1 < f[j]) f[j] = f[j - x] + 1; return f; }
function madeHalves(w, m) { const f = new Array(13).fill(0.5); for (const x of w) for (let j = x; j <= 12; j++) f[j] -= f[j - x] * 0.5; return f; }
function madeDown(w, m) { const f = new Array(13).fill(0); f[0] = 1; for (const x of w) for (let j = 12; j >= x; j--) f[j] += f[j - x]; return f; }
function madeSteps(w, m) { const f = new Array(13).fill(0); for (const x of w) for (let j = x; j <= 12; j += 2) f[j]++; return f; }
function madeNext(w, m) { const f = new Array(13).fill(1); let n = 0; for (const x of w) for (let j = x; j < 12; ) { f[j] += f[++j]; if (++n > 200) break; } return f; }
function oneStart(w, m) { const f = new Array(13).fill(2); let s = 0; for (let j = w[0]; j <= 12; j++) { f[j] *= f[j - w[0]]; s += f[j]; } f.push(s); return f; }
for (const f of [ways, fewest, lists, madeWays, madeFewest, madeHalves, madeDown, madeSteps, madeNext, oneStart]) for (const m of makers) for (const a of starts) for (const b of [1, 3, a]) { calls = 0; let answer; try { answer = show(f([a, b, 2], m)); } catch (x) { answer = x.constructor.name; } keep(f.name + " " + answer + calls); }
console.log(cases, digest); for (const x of said) console.log(x);
