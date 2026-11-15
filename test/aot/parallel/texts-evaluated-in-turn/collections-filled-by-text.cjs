// Text evaluated at run time adds to Maps and Sets of every kind: keys and values that are numbers, strings, objects and others, tables that are full, shared with the executable, walked and cleared, and receivers that are none.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [];
const text = v => v === null ? "null" : typeof v === "function" ? "function" : v instanceof Map ? "Map(" + [...v].map(text) + ")" : v instanceof Set ? "Set(" + [...v].map(text) + ")" : typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(text) + "]" : "{" + Object.keys(v).map(k => k + ":" + text(v[k])).join() + "}") : typeof v === "symbol" ? v.toString() : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : String(v);
const show = (name, v) => lines.push(name + ": " + text(v));
const attempt = f => { try { return f(); } catch (e) { return "!" + e.constructor.name + " " + e.message; } };
const set = F("m", "k", "v", "return m.set(k, v);"), add = F("s", "k", "return s.add(k);");
const shared = { s: "shared" }, symbol = Symbol("of the program"), rope = a => "rope " + a + " of " + (a * 2);
const keys = [0, 1, -0, 0.5, -1.25, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), 2 ** 53, "", "a", "ab", "key", "ключ", rope(1), rope(1), "0", "1", "-0", shared, {}, [], symbol, Symbol.iterator, Symbol.for("x"), 5n, 5n, 2n ** 70n, 2n ** 70n, true, false, null, undefined, set, /x/, new Date(0), "a".repeat(40), "é", String(0.5)];
const values = [0, -0, 1.5, NaN, "", "text", rope(2), shared, null, undefined, true, 7n, symbol, set, [1, 2], 2 ** 40, -1];
for (const first of [undefined, 1, "a", 0.5, shared, symbol, 5n, true]) for (const more of [1, 3, 9, 17, 40]) {
  const m = new Map(), s = new Set();
  if (first !== undefined) { m.set(first, "first"); s.add(first); }
  for (let i = 0; i < more; i++) { const k = keys[(i * 7 + more) % keys.length]; show("same", [set(m, k, values[(i * 5) % values.length]) === m, add(s, k) === s]); }
  show("map of " + String(first && first.toString()) + " " + more, m); show("set of it", s); show("sizes", [m.size, s.size]);
}
// One kind of key alone, over every size, with each kind of value in turn.
const families = { ints: i => i, smalls: i => i & 7, negatives: i => -i, doubles: i => i + 0.5, mixed: i => i & 1 ? i : i / 4, texts: i => "k" + i, ropes: i => "k" + i + "/" + (i * 3), objects: (i, l) => l[i] ??= { i }, symbols: (i, l) => l[i] ??= Symbol("s" + i), every: (i, l) => [i, "k" + i, l[i] ??= [i], i + 0.25, null, i & 1 ? true : undefined, BigInt(i & 3)][i % 7] };
for (const [name, key] of Object.entries(families)) for (const count of [1, 4, 8, 9, 16, 17, 33, 65, 130, 300]) {
  const m = new Map(), s = new Set(), l = []; let same = 0;
  for (let round = 0; round < 2; round++) for (let i = 0; i < count; i++) { const k = key(i, l); same += set(m, k, values[(i + round) % values.length]) === m; same += add(s, k) === s; }
  let found = 0; for (let i = 0; i < count; i++) { const k = key(i, l); found += m.has(k) + s.has(k); }
  show(name + " " + count, [same, found, m.size, s.size, [...m.values()].slice(-5), [...s].slice(-3).map(x => typeof x)]);
}
// Values that change their width in one table.
for (const order of [[1, "t", shared], ["t", 1, null], [null, undefined, 1.5], [shared, 2, "u"], [true, 0.5, 9n]]) {
  const m = new Map(); for (let i = 0; i < 20; i++) set(m, i & 7, order[i % order.length]); show("widths", m);
  const t = new Map(); for (let i = 0; i < 20; i++) set(t, "k" + (i & 7), order[i % order.length]); show("widths of texts", t);
}
// Tables that the executable holds, and copies of them.
const held = new Map([["a", 1], ["b", "two"], ["c", null]]), heldSet = new Set(["x", "y", "z"]), heldInts = new Map([[1, 2], [3, 4]]);
for (let i = 0; i < 6; i++) { show("held", [set(held, "a", i) === held, set(held, "n" + i, i) === held, add(heldSet, "x") === heldSet, add(heldSet, "n" + i) === heldSet, set(heldInts, i, i) === heldInts]); }
show("held now", [held, heldSet, heldInts]);
// Walked, cleared and deleted from while text adds.
const walk = F("m", "s", "const out = []; for (const [k, v] of m) { out.push(k, v); if (m.size < 12) m.set(m.size, k); if (out.length > 60) break; } for (const k of s) { out.push(k); if (s.size < 12) s.add(s.size); if (out.length > 90) break; } return out.join();");
show("walked", walk(new Map([[0, 1]]), new Set([0])));
const churn = F("m", "s", "n", "let t = 0; for (let i = 0; i < n; i++) { m.set(i & 31, i).set('k' + (i & 15), i); s.add(i & 15).add('s' + (i & 7)); if (i % 5 === 0) { m.delete(i & 31); s.delete(i & 15); } if (i % 97 === 0) { m.clear(); s.clear(); } t += m.size + s.size; } return t;");
show("churned", [churn(new Map(), new Set(), 2000), churn(new Map([["a", 1]]), new Set(["a"]), 500)]);
const inForEach = F("m", "const out = []; m.forEach((v, k) => { out.push(k); if (m.size < 10) m.set(k + 1, v); m.set(k, -v); }); return out.join() + [...m];");
show("in forEach", inForEach(new Map([[1, 2], [2, 3]])));
// Receivers and arguments of every kind.
const call = F("f", "receiver", "args", "return f.call(receiver, ...args);"), few = F("m", "s", "return [m.set(), m.set(1), m.set('only'), s.add(), m.size, s.size, m.get(undefined), m.get(1)].map(x => x === m ? 'm' : x === s ? 's' : x);"), many = F("m", "s", "return [m.set(1, 2, 3, 4) === m, s.add(1, 2, 3) === s, [...m], [...s]];");
show("few", few(new Map(), new Set())); show("many", many(new Map(), new Set()));
for (const receiver of [1, "a", null, undefined, {}, [], new Set(), new Map(), new WeakMap(), new WeakSet(), Map.prototype, Object.create(Map.prototype), new Proxy(new Map(), {}), function () {}]) show("receiver", [attempt(() => call(Map.prototype.set, receiver, [1, 2]) === receiver), attempt(() => call(Set.prototype.add, receiver, [1]) === receiver), attempt(() => call(Map.prototype.set, receiver, ["k", shared]) === receiver), attempt(() => call(Set.prototype.add, receiver, ["k"]) === receiver)]);
const bound = F("m", "s", "const f = m.set.bind(m), g = s.add.bind(s); return [f(1, 2) === m, g(1) === s, [1, 2].forEach(m.set, m), [[3, 4]].map(x => Reflect.apply(m.set, m, x) === m), [...m], [...s]];");
show("bound", bound(new Map(), new Set()));
class OwnMap extends Map { set(k, v) { lines.push("own set " + text(k)); return super.set(k, text(v)); } }
class OwnSet extends Set { add(k) { return super.add(typeof k === "number" ? -k : k); } }
class PlainMap extends Map { extra = 1; }
const heirs = F("OwnMap", "OwnSet", "PlainMap", "const a = new OwnMap([[1, 2]]), b = new OwnSet([1, 2]), c = new PlainMap([[1, 2]]); for (let i = 0; i < 12; i++) { a.set(i, i); b.add(i); c.set(i & 3, i).set('k' + i, i); } return [a, b, c, c.extra];");
show("heirs", heirs(OwnMap, OwnSet, PlainMap));
const frozen = Object.freeze(new Map()), sealed = Object.seal(new Set());
show("frozen", [attempt(() => set(frozen, 1, 2).size), attempt(() => add(sealed, 1).size)]);
const weak = F("w", "s", "k", "v", "return [w.set(k, v) === w, s.add(k) === s, w.get(k), s.has(k)];");
for (const k of [shared, symbol, 1, "a", Symbol.for("x"), null]) show("weak", attempt(() => weak(new WeakMap(), new WeakSet(), k, "v")));
// Own methods in front of the built-in ones, and objects that are not their realm's.
const replaced = F("m", "s", "let n = 0; const set = m.set, add = s.add; m.set = function (k, v) { n++; return set.call(this, k, v); }; s.add = function (k) { n += 100; return add.call(this, k); }; for (let i = 0; i < 5; i++) { m.set(i, i); s.add(i); } delete m.set; delete s.add; m.set(9, 9); s.add(9); return [n, m.size, s.size];");
show("own methods", replaced(new Map([[1, 2]]), new Set([1])));
const other = require("node:vm").runInNewContext("[new Map(), new Set(), Map.prototype.set, Set.prototype.add]");
for (let i = 0; i < 10; i++) { set(other[0], i & 3, i); add(other[1], "k" + (i & 3)); other[2].call(other[0], "o", i); other[3].call(other[1], i); }
show("of another realm", [[...other[0]].join("|"), [...other[1]].join("|"), attempt(() => call(other[2], new Map(), [1, 2]).size), attempt(() => call(Map.prototype.set, other[0], ["p", 1]) === other[0])]);
// Young values in old tables.
const old = new Map(), oldSet = new Set(); for (let i = 0; i < 64; i++) { set(old, i, null); set(old, "k" + i, null); add(oldSet, i); }
if (typeof Bun !== "undefined") Bun.gc(true);
for (let round = 0; round < 3; round++) { for (let i = 0; i < 64; i++) { set(old, i, { round, i, list: [i, "x" + i] }); set(old, "k" + i, "value " + i + " of " + round); add(oldSet, "y" + (i & 7)); } let trash = []; for (let i = 0; i < 20000; i++) trash.push({ i, t: "trash " + i }); trash = null; if (typeof Bun !== "undefined") Bun.gc(round === 2); let sum = 0; for (const [k, v] of old) sum += typeof v === "string" ? v.length : v.i + v.list[1].length + v.round; show("young in old", [sum, old.size, [...oldSet].length]); }
console.log(lines.join("\n"));
