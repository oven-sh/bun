// Map.groupBy and Object.groupBy of every kind of items, by every kind of key.
const seed = JSON.parse('[5,3,9,1,7,2,8,6,4,0,3,5]'), zero = seed[9], nan = zero / zero, all = process.argv[2] === "all"; let lines = 0, hash = 0, log = "";
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 220)); else if (lines % 19 === 0) console.log(lines, hash); }
function show(v) { return typeof v === "string" ? "'" + v + "'" : v === null ? "null" : typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + (v.k ?? "") + "}") : typeof v === "symbol" ? "sym" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v); }
class Sub extends Array { *[Symbol.iterator]() { log += "S"; for (let i = 0; i < this.length; i += 2) yield this[i]; } }
class Plain extends Array {}
function closing(list) { return { [Symbol.iterator]() { let i = 0; return { next() { log += "n"; return i < list.length ? { value: list[i++], done: false } : { value: undefined, done: true }; }, return() { log += "r"; return {}; } }; } }; }
const items = {
  ints: () => seed.slice(), none: () => [], holes: () => [1, , 3, , 5], rows: () => seed.map(k => ({ k })), doubles: () => seed.map(x => x / 4), strings: () => ["b", "a", "b", "", "é"], mixed: () => [1, "1", null, undefined, nan, -zero, zero, true, 1n], set: () => new Set(seed), map: () => new Map([[1, 2], [3, 4]]), text: () => "hello", typed: () => new Uint8Array(seed), generator: () => (function* () { try { yield* seed; } finally { log += "f"; } })(), sub: () => Sub.from(seed), plain: () => Plain.from(seed), own: () => Object.assign(seed.slice(), { [Symbol.iterator]: function* () { log += "o"; yield 1; yield 2; } }), closing: () => closing(seed), frozen: () => Object.freeze(seed.slice()), args: () => (function () { return arguments; })(1, 2, 1), like: () => ({ length: 2, 0: 1, 1: 2 }), number: () => 5, nothing: () => null, proxy: () => new Proxy(seed.slice(), { get(t, k, r) { if (k === "length") log += "L"; return Reflect.get(t, k, r); } }), many: () => Array.from({ length: 500 }, (_, i) => i),
};
const callbacks = {
  odd: x => x & 1, self: x => x, zeros: () => -zero, nans: () => nan, text: x => "k" + x, object: x => (x && typeof x === "object" ? x : items), third: (x, i) => i % 3, undefinedKey: () => undefined, symbol: () => Symbol.iterator, throws: (x, i) => { if (i === 2) throw new Error("stop"); return i; }, counts: function (x, i) { log += arguments.length; if (this !== undefined) log += "T"; return i > 4; }, big: () => 1n, list: x => [x], proto: () => "__proto__", doubles: x => (typeof x === "number" ? x / 2 : 0.5),
};
for (const i of Object.keys(items)) for (const c of Object.keys(callbacks)) for (const by of [Map, Object]) {
  log = ""; let out; try { const g = by.groupBy(items[i](), callbacks[c]); out = by === Map ? g.size + " " + [...g].map(([k, v]) => show(k) + ":" + show(v)).join(" ") + " " + g.constructor.name : Reflect.ownKeys(g).map(k => show(k) + ":" + show(g[k])).join(" ") + " " + Object.getPrototypeOf(g); } catch (e) { out = e.name + (e.message === "stop" ? "stop" : ""); } say([i, c, by.name, out, log].join(" "));
}
for (const f of [undefined, null, 1, "x", {}]) for (const l of [seed, null, 5]) { let out; try { out = Map.groupBy(l, f).size; } catch (e) { out = e.name; } say("bad " + out); }
for (const change of [l => { l.length = 3; }, l => { l.push(77); }, l => { l[4] = "x"; }, l => { l.shift(); }, l => { l.length = 0; }, l => { delete l[5]; }, l => { l[Symbol.iterator] = null; }, l => { Object.freeze(l); }, l => { l[2] = 0.5; }]) for (const at of [0, 2]) for (const by of [Map, Object]) {
  const l = seed.slice(0, 8); let out; try { const g = by.groupBy(l, (x, i) => { if (i === at) change(l); return i < 40 ? typeof x : "y"; }); out = [...(by === Map ? g : Object.entries(g))].map(([k, v]) => show(k) + ":" + show(v)).join(" "); } catch (e) { out = e.name; } say("changed " + out);
}
const g = Map.groupBy(seed, x => x % 3); g.set(0, g.get(0)?.concat(1)); g.get(1)?.push(9); say([...g].map(show).join() + g.has(-0) + g.get(-0)?.length);
function total(rows) { let s = 0; for (const [k, v] of Map.groupBy(rows, r => r.k % 4)) for (const r of v) s += r.k * k; return s; } let sum = 0; for (let i = 0; i < 30; i++) sum += total(items.rows()); say(String(sum));
let first; try { Map.groupBy(seed, () => { throw new Error("deep"); }); } catch (e) { first = e.message; } say(first); say(Map.groupBy.length + Map.groupBy.name);
console.log("lines", lines, hash);
