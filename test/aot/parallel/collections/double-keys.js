// Maps and sets under doubles, int32s in doubles, both zeros, infinities and NaN of every making, beside keys of other kinds.
const seed = JSON.parse("[0,1,2,3,4.5,1e21,-7,2147483647,2147483648,-2147483648,-2147483649,0.1,0.2,9007199254740993,5e-324,1.7976931348623157e308]");
const zero = seed[0], one = seed[1], nans = [zero / zero, -(zero / zero), Math.sqrt(-one), NaN, Infinity - Infinity, Number("x"), new Float64Array([NaN])[0], new Float64Array(new BigUint64Array([0xfff8000000000001n]).buffer)[0], new Float32Array([NaN])[0]];
const numbers = [...seed, -zero, -seed[4], seed[11] + seed[12], 0.3, seed[2] / 2, seed[3] - seed[2], seed[4] * 2, seed[4] + 0.5, seed[8] - 1, seed[9] + 0.5, Infinity, -Infinity, ...nans, 1 / 3, 2 ** 52 + 0.5, 4294967295, 4294967296.5];
const others = ["4.5", "a", true, null, undefined, 1n, {}, Symbol.iterator], keys = [...numbers, ...others];
const all = process.argv[2] === "all"; let lines = 0, hash = 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 200)); else if (lines % 29 === 0) console.log(lines, hash); }
function show(v) { return typeof v === "object" ? "o" : typeof v === "symbol" ? "s" : Object.is(v, -0) ? "-0" : typeof v === "string" ? "'" + v + "'" : String(v); }
function contents(m) { return [...m].map(e => Array.isArray(e) ? show(e[0]) + "=" + e[1] : show(e)).join(); }
function fill(list) { const m = new Map(), s = new Set(); for (let i = 0; i < list.length; i++) { m.set(list[i], i); s.add(list[i]); } return [m, s]; }
function count(list) { const m = new Map(); for (const k of list) m.set(k, (m.get(k) ?? 0) + 1); return m; }
function look(m, s, k) { return [m.get(k), m.has(k), s.has(k)].join("/"); }
function drop(m, s, k) { return [m.delete(k), s.delete(k), m.size, s.size].join("/"); }
function group(list) { const m = new Map(); for (const k of list) { const l = m.get(k); if (l) l.push(k); else m.set(k, [k]); } let t = ""; for (const [k, v] of m) t += show(k) + v.length + ","; return t; }
const lists = { numbers, keys, one: [seed[4]], strings: ["a", "b"], ints: [1, 2, 3], none: [], few: [0.5, 1.5, "a"], many: Array.from({ length: 300 }, (_, i) => i * 0.75), twice: [...numbers, ...numbers.map(x => x + 0)], narrow: others.filter(x => typeof x !== "bigint"), large: Array.from({ length: 5000 }, (_, i) => (i % 1000) / 8) };
for (const n of Object.keys(lists)) {
  const [m, s] = fill(lists[n]); say(n + " " + contents(m).slice(0, 400) + contents(s).length); say(n + contents(count(lists[n])).slice(0, 400)); say(n + group(lists[n]).slice(0, 400));
  for (const k of keys) say(n + show(k) + look(m, s, k));
  for (let i = 0; i < keys.length; i += 3) say(n + show(keys[i]) + drop(m, s, keys[i]) + look(m, s, keys[i]));
  for (const k of keys) { m.set(k, "x"); s.add(k); } say(n + contents(m).slice(0, 600) + contents(s).length);
  const held = m.entries(); held.next(); for (const k of numbers) { m.delete(k); m.set(k, "y"); } say(n + [...held].length + m.size);
}
for (const k of keys) { const m = new Map([[k, 1]]), s = new Set([k]); let t = ""; for (const l of keys) t += (m.get(l) ?? "-") + (s.has(l) ? "+" : "-"); say(show(k) + t); const [first] = m.keys(); say(show(first) + Object.is(first, k)); }
class Cache extends Map { get(k) { return super.get(k) ?? "none"; } } const cache = new Cache(); for (const k of keys) cache.set(k, show(k)); say(keys.map(k => cache.get(k)).join()); say([0.25, 7.5].map(k => cache.get(k)).join());
const weak = new WeakMap(), w = {}; weak.set(w, 1.5); for (const k of [1.5, NaN, -0]) say(String(weak.has(k)) + weak.get(k)); say(String(weak.get(w)));
console.log("lines", lines, hash);
