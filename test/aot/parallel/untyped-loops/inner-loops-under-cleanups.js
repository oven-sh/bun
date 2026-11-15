// Loops inside the bodies of for-of loops: what they throw closes the iteration of the loop around.
// STATISTIC: SiteCachedReadsHoisted >= 4
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 211 === 1) said.push(text.slice(0, 170)); }
function show(x, d = 0) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : d > 1 ? "..." : Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 12) }, (_, i) => i in x ? show(x[i], d + 1) : "_").join() + "]" + x.length : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const named = (names, values, o = {}) => { names.split(" ").forEach((n, i) => { o[n] = values[i]; }); return o; };
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; if (value === fails) throw new RangeError("got"); return value; }, set(v) { calls += 100; value = v; }, enumerable: true, configurable: true });
const fails = { valueOf() { throw new RangeError("no"); }, toString() { throw new TypeError("no"); } };
const lists = [() => ["a", "b", "c", "b"], () => [1, 2, 3, 2], () => [0.5, 1.5, NaN, 1.5], () => [1, "b", null, undefined], () => [, 2, , 2], () => [], () => new Float64Array([1, 2, 3, 2]), () => Object.freeze([1, 2, 3, 2]), () => "abcb", () => got([1, 2, 3, 2], 2, 2), () => got([1, 2, 3, 2], 2, fails), () => new Proxy([1, 2, 3, 2], { get(t, k) { calls++; return t[k]; } }), () => undefined, () => 5];
const item = (name, w, row) => named("name w row", [name, w, row]);
const items = () => [item("b", 2, [1, 2, 3, 2]), item("c", 0.5, [0.5, 1.5, 2.5, 0.5]), item(2, 3, ["a", "b", "c", "d"]), item(1.5, "x", [1, , 3, 4])];
const closing = (list, how) => ({ [Symbol.iterator]() { let at = 0; return { next() { calls += 1000; return at < list.length ? { value: list[at++], done: false } : { value: undefined, done: true }; }, return() { calls += 100000; if (how === 1) throw new SyntaxError("closing"); return how === 2 ? 5 : {}; } }; } });
function* made(list) { try { for (const x of list) yield x; } finally { calls += 1000000; } }
const holders = [l => l, l => new Set(l), l => new Map(l.map((x, i) => [i, x])).values(), l => made(l), l => closing(l, 0), l => closing(l, 1), l => closing(l, 2), l => new (class extends Array {})(...l), l => l.values(), l => { const a = l.slice(); a[Symbol.iterator] = function* () { yield* l; }; return a; }, l => l[0], l => null];
function equalNames(h, c) { let n = 0; for (const it of h) for (let j = 0; j < c.words.length; j++) if (c.words[j] === it.name) n += it.w; return n; }
function longerNames(h, c) { let n = 0; for (const it of h) for (let j = 0; j < c.words.length; j++) if (c.words[j].length > it.name.length) n++; return n; }
function rowSums(h, c) { const t = new Array(4).fill(0); for (const it of h) for (let j = 0; j < 4; j++) t[j] += it.w * it.row[j & 3]; return t; }
function rowFills(h, c) { for (const it of h) for (let j = 0; j < it.row.length; j++) it.row[j] = c.k; return show([...h].map(x => x && x.row)); }
function rowMoves(h, c) { for (const it of h) for (let j = 1; j < it.row.length; j++) it.row[j] = it.row[j - 1]; return 0; }
function innerOf(h, c) { let n = 0; for (const it of h) for (const w of c.words) if (w === it.name) n++; return n; }
function greatest(h, c) { let m = -Infinity; for (const it of h) for (const v of it.row) m = Math.max(m, v); return m; }
function throwsInside(h, c) { let n = 0; for (const it of h) for (let j = 0; j < c.words.length; j++) { if (c.words[j] === it.name) n++; if (n === 2) throw c.k; } return n; }
function breaksOut(h, c) { let n = 0; outer: for (const it of h) for (let j = 0; j < c.words.length; j++) { if (c.words[j] === it.name) n++; if (n === 2) break outer; } return n; }
function goesOn(h, c) { let n = 0; outer: for (const it of h) for (let j = 0; j < c.words.length; j++) { if (c.words[j] === it.name) continue outer; n++; } return n; }
function returns(h, c) { for (const it of h) for (let j = 0; j < c.words.length; j++) if (c.words[j] === it.name) return j; return -1; }
function caught(h, c) { let n = 0; for (const it of h) { try { for (let j = 0; j < c.words.length; j++) { if (c.words[j] === it.name) n++; n += it.row[j] * 1; } } catch (e) { n += 1000; } } return n; }
function settled(h, c) { let n = 0; for (const it of h) { try { for (let j = 0; j < c.words.length; j++) if (c.words[j] === it.name) n++; } finally { n += 10; } } return n; }
function stores(h, c) { const d = [0, 0, 0, 0]; for (const it of h) for (let j = 0; j < c.words.length; j++) { d[j] = j; if (c.words[j] === it.name) d[j] = it.w; } return d; }
function replaces(h, c) { let n = 0; for (const it of h) for (let j = 0; j < c.words.length; j++) { if (c.words[j] === it.name) { n++; c.words = [it.name, it.name]; } } return n; }
function twoDeep(h, c) { let n = 0; for (const a of h) for (const b of [a, a]) for (let j = 0; j < c.words.length; j++) if (c.words[j] === b.name) n++; return n; }
function counts(h, c) { const m = {}; for (const it of h) for (let j = 0; j < 4; j++) { m[it.row[j]] = (m[it.row[j]] || 0) + 1; if (it.row[j] === c.k) m.k = j; } return Object.keys(m) + Object.values(m); }
const constants = [2, 0.5, "b", NaN, undefined, fails, null, 3n];
let place = 0;
function tried(f, h, c) { calls = 0; let answer; try { answer = show(f(h, c)); } catch (e) { answer = e && e.constructor ? e.constructor.name + (e.message === "no" || e.message === "closing" || e.message === "got" ? e.message : "") : show(e); } keep(f.name + " " + answer + " " + calls); }
for (const f of [equalNames, longerNames, rowSums, rowFills, rowMoves, innerOf, greatest, throwsInside, breaksOut, goesOn, returns, caught, settled, stores, replaces, twoDeep, counts]) for (const h of holders) for (const w of lists) for (const k of constants) { if (place++ % 2) continue; const l = items(); if (place % 5 === 0) l[place % 4] = [null, undefined, 5, got(item("b", 2, [1, 2, 3, 4]), "name", fails), got(item("b", 2, [1, 2, 3, 4]), "row", [2, 2, 2, 2]), item("b", 2, undefined), Object.create(item("b", 2, [1, 2]))][place % 7]; const c = place % 3 ? named("words k", [w(), k]) : got(named("k", [k]), "words", w()); tried(f, h(l), c); }
console.log(cases, digest); for (const x of said) console.log(x);
