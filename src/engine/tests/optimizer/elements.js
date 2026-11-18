class Plain {}
class Inherits {}
Inherits.prototype[1] = "inherited";
Inherits.prototype[-1] = "below";
class Watches {
  get 1() { return "getter"; }
  set 1(value) { this.seen = value; }
  get "-1"() { return "negative getter"; }
}
const tagged = (base, more) => Object.assign(base, more);
const sparse = () => { const a = [1]; a[500000] = 2; a.toJSON = () => [a[0], a[1], a[7], a[-1]]; return a; };
const makers = String.raw`
  [1, 2, 3]; Array.of(1, 2, 3); [1.5, 2.5, 3.5]; Array.of(1.5, 2.5); ["a", {}, null]; Array.of("a", "b"); [1, , 3]; [1.5, , 3.5]; ["a", , "c"];
  []; new Array(3); {}; { 0: 1, 1: 2 }; { 0: 1, 2: 3 }; Object.create(null); tagged([1, 2], { "-1": "named" }); tagged(new Plain(), { 0: 1 });
  tagged(new Inherits(), { 0: 1, 2: 3 }); new Inherits(); tagged(new Watches(), { 0: 1, 2: 3 }); new Watches(); Object.setPrototypeOf([1, , 3], ["x", "y"]);
  sparse(); Object.freeze(Array.of(1, 2)); Object.seal(Array.of(1, 2)); Object.preventExtensions([1, , 3]); Object.defineProperty([1, 2], "length", { writable: false });
  "abc"; "\u0100\u0101"; new String("abc"); new Int16Array(3); new Float32Array(3); (function () { return arguments })(1, 2); (function (a) { return (() => a), arguments })(1, 2);
  (function (...a) { return arguments })(1, 2); new Proxy([1, 2], {}); 5; null; Symbol.iterator; function () {}`.split(";").map(text => eval(`() => [${text}]`));
const bases = lazily(makers, make => make());
for (const key of [1, 7, -1, -2]) {
  check(`a => a[${key}]`, bases);
  check(`a => ${key} in a`, bases);
}
check("a => a.length", bases);
check("a => [a.length, a[0]]", () => [[[1]], [Array.prototype], [[]]]);
for (const [key, value] of [[1, "4"], [1, "4.5"], [1, "NaN"], [1, '"v"'], [3, "4"], [3, "4.5"], [3, '"v"'], [-1, "4"], [2000, "4.5"]]) {
  check(`a => { "use strict"; a[${key}] = ${value}; return [a[0], a[1], a[${key}], a.length, a.seen]; }`, bases);
}

// Several kinds take turns.
const turns = () => [Array.of(1, 2, 3), Array.of(1.5, 2.5, 3.5), Array.of("a", "b", "c"), new Uint8Array(3), "xyz", [], { 1: 0 }];
for (let left = 0; left < 7; left += 2) {
  check(`(list, i) => list.map(a => show(a[i]) + a.length).join() /* ${left} */`, () => [0, 2, 3, -1].map(i => [turns().toSpliced(left, 1), i]));
  check(`(list, v) => { for (const a of list) a[1] = a[3] = v; return list; } /* ${left} */`, () => [1, 1.5, NaN, {}].map(v => [turns().toSpliced(left, 1), v]));
}
check("(n, v) => { const a = []; for (let i = 0; i < n; i++) a[i] = i === 5 ? v : i; return a; }", () => [[9, 1], [9, 0.5], [9, "s"], [40, NaN], [3, 0]]);
check("(n, v) => { const a = [1, 2, 3]; a[n] = v; return [a, [1, 2, 3], a.length]; }", () => [[0, 1], [1, 0.5], [3, "s"], [9, 2], [-1, 2], [1e6, 2].map((it, i) => (i ? it : 5))]);
check("(n, v) => { const o = {}; o[n] = v; o[n + 1] = v; return o; }", () => [[0, 1], [1, 0.5], [3, "s"], [5000, 2], [-1, 2]]);
check("(a, i) => { const before = a[i]; a[a.length] = 5; return [before, a[i], a.length]; }", () => [[Array.of(1), 0], [Array.of(1), 1], [Array.of(1.5), 1], [[], 0]]);
check("(a, i) => a[i >>> 0]", () => [[Array.of(1, 2), 1], [Array.of(1, 2), 5], [tagged(Array.of(1, 2), { "-1": 3, 4294967295: 4 }), -1]]);
check("(a, i) => a[i]", () => [0, 1, -0, 1.5, 2 ** 32, NaN, "1", "length", undefined].map(i => [Array.of(1, 2), i * 1 === i ? i / 2 + i / 2 : i]));
check("function (a, b) { const args = arguments; a = 7; (() => b); b = 8; let s = ''; for (let i = 0; i < 4; i++) s += args[i]; return s + args.length; }", () => [[1], [1, 2], [1, 2, 3], []]);
check("(change, ...rest) => { const args = (function (a) { return arguments; })(...rest); change(args); return [args[0], args[1], args.length]; }",
  () => [() => {}, args => delete args[0], args => delete args[1], args => (args.length = 9), args => Object.defineProperty(args, 0, { get: () => 3 })].map(change => [change, 1, 2]));

check("(a, i) => { let s = ''; for (let k = 0; k < 9; k++) s += a[i]; return s; }", () => [["ab", 1], ["ab", 1e9], [Array.of(1, 2), 1], [Array.of(1, 2), 1e9], [Array.of(0.5), 1e9], [new Int32Array(2), 1e9]]);

// Keys that are names.
const symbol = Symbol("k"), late = (...parts) => parts.join("");
const names = () => ["key", late("k", "ey"), "k" + late("e", "y") + "", "other", late("ke", "z"), symbol, Symbol("k"), 1, "1", { toString: () => "key" }, undefined];
const holders = () => [{ key: 1, other: 2, [symbol]: 3, 1: 4 }, { other: 5, key: 6 }, Object.create({ key: 7 }), { get key() { return 8; } }, [9, 10], "s"];
check("(o, k) => o[k]", () => names().map(k => [holders()[0], k]).concat(holders().map(o => [o, "key"]), holders().map(o => [o, symbol])));
check("(o, k) => { o[k] = 0; return [o, o.key]; }", () => names().map(k => [{ other: 1 }, k]).concat(holders().map(o => [o, "key"])));
for (const key of ["1", "-1", "'1'", "'length'"]) check(`a => [Object.prototype.hasOwnProperty.call(a, ${key}), Object.hasOwn(a, ${key})]`, bases);
check("(o, k) => { const before = o.hasOwnProperty(k); o[k] = 1; const after = o.hasOwnProperty(k); delete o[k]; return [before, after, o.hasOwnProperty(k)]; }",
  lazily([...names().keys(), "name", "prototype", "message", "stack"], i => (typeof i === "number" ? [i & 1 ? holders()[0] : Object.create(holders()[0]), names()[i]] : [i > "n" && i < "q" ? function () {} : new Error("m"), i])));
const many = [...Array(24).keys()].map(i => "k" + i).concat(symbol, "toString");
const unusual = () => [late("k", "3"), "0", late("1", "2"), "missing", "size", "__proto__", Symbol(), 5];
const table = () => Object.assign({ get size() { return 7; }, set size(v) { this.k0 = v; }, 0: "zero" }, Object.fromEntries(many.slice(0, 20).map(k => [k, 1])));
check("(o, keys, last) => { let s = ''; for (const k of keys) s += typeof o[k]; return s + show(o[last]) + (() => { keys = [last]; for (const k of keys) return show(o[k]); })(); }", lazily([0, 1, 2, 3, 4, 5, 6, 7], i => [table(), many, unusual()[i]]));
check("(o, keys) => keys.map(k => show(o[k])).join()", lazily([0, 1, 2, 3, 4, 5, 6, 7, [1], "s", new Proxy({}, { get: (_, k) => typeof k })], i => (typeof i === "number" ? [table(), [...many, unusual()[i]]] : [i, many])));
check("(o, keys) => { for (const k of keys) o[k] = keys; return [Reflect.ownKeys(o).length, o.k0 === keys, Object.getPrototypeOf(o) === keys]; }",
  lazily([0, 1, 2, 3, 4, 5, 6, 7, () => Object.freeze({}), () => [], () => Object.create(table()), () => function () {}], i => (typeof i === "number" ? [i & 1 ? {} : table(), [...many, unusual()[i]]] : [i(), [...many, "size", "length"]])));
const emptied = proto => { const o = Object.setPrototypeOf(Object.fromEntries([...Array(200).keys()].map(i => ["k" + i, i])), proto); delete o.k0; delete o.k1; return o; };
const tables = [null, Object.prototype, table(), [1], new Proxy({}, { get: () => "trap" }), function () {}, new Uint8Array(1)].map(emptied);
check("(o, keys) => { let s = ''; for (const k of keys) s += typeof o[k]; return s; }", () => tables.map(o => [o, [...many, "size", "length", "name", "-0"]]));
check("(o, k) => ({ [k]: o, x: 1 })", () => names().map(k => [1, k]));
check("o => { const get = (a, k) => a[k]; return [get(o, 'key'), get(o, 'other'), get(o, '1'), get(o, 'length')]; }", () => holders().map(o => [o]));

// A store that changes a shape on which the code counts.
{
  const make = () => Object.assign(new (class {})(), { 0: 1 });
  const kept = make();
  const step = (0, eval)("kept => (other, v) => { other[0] = v; return kept[0] + kept[0]; }")(kept);
  for (let i = 0; i < 100; i++) step(i & 1 ? {} : make(), i & 2 ? 0.5 : 1);
  if (step(kept, 0.25) !== 0.5) throw new Error("the elements are read as what they were");
}

// The prototypes get elements. This has to be last.
{
  const read = (a, i) => a[i], has = (a, i) => i in a, write = (a, i) => { a[i] = 1; };
  const all = () => [read([1, , 3], 1), read(Array.of(1), 1), read({ 0: 1 }, 1), read("a", 1), has([1, , 3], 1)].join();
  const each = [[1, , 3], [1.5, , 3], Array.of(1), { 0: 1 }, {}, "a"].map(a => [(0, eval)("(a, i) => a[i]"), a]);
  for (let i = 0; i < 100; i++) all(), write([1, , 3], 1), each.forEach(([f, a]) => f(a, 1));
  const below = (0, eval)("(a, i) => a[i]"), table = sparse();
  for (let i = 0; i < 100; i++) below(Array.of(1), (i & 1) - 1), below(table, i);
  Array.prototype[-1] = "below";
  if (below(Array.of(1), -1) !== "below") throw new Error("-1 is not inherited");
  let stored;
  Object.defineProperty(Object.prototype, 1, { get: () => "p", set(value) { stored = value; }, configurable: true });
  if (all() !== "p,p,p,p,true") throw new Error(all());
  if (each.some(([f, a]) => f(a, 1) !== "p")) throw new Error("not inherited");
  if (below(table, 1) !== "p") throw new Error("not inherited by a table");
  write([1, , 3], 1);
  if (stored !== 1) throw new Error("the setter has not run");
}
