"use strict";
// Object.fromEntries of maps, arrays, iterators and generators, in calls, in loops and passed around; keys of every kind, entries that are none, protocols that were replaced on one object, and iterators that are closed.
const show = o => { if (o === null || typeof o !== "object") return String(o); return Reflect.ownKeys(o).map(k => String(k) + ":" + (typeof o[k] === "object" && o[k] ? "{" + Object.keys(o[k]) + "}" : String(o[k]))).join() + "|" + (Object.getPrototypeOf(o) === Object.prototype); };
const attempt = f => { try { return show(f()); } catch (e) { return e.name + ": " + (/is not (a function|iterable)/.test(e.message) ? "" : e.message); } };
const s = Symbol("s"); const log = [];
class M extends Map {} class Own extends Map { *[Symbol.iterator]() { yield ["own", this.size]; } } class L extends Array {}
const changedMap = new Map([["a", 1]]); changedMap[Symbol.iterator] = function* () { yield ["changed", 2]; };
const changedList = [["a", 1]]; changedList[Symbol.iterator] = function* () { yield ["changed", 3]; };
const counted = entries => ({ [Symbol.iterator]() { let i = 0; return { next() { log.push("n" + i); return i < entries.length ? { value: entries[i++], done: false } : { done: true, value: undefined }; }, return() { log.push("r"); return {}; } }; } });
const badKey = { toString() { throw new RangeError("key"); } };
const loudEntry = { get 0() { log.push("0"); return "k"; }, get 1() { log.push("1"); return "v"; } };
const thrower = { get 0() { return "k"; }, get 1() { throw new EvalError("value"); } };
const makers = {
  map: i => new Map([["a", i], ["b", i + 1]]), empty: () => new Map(), numbers: i => new Map([[2, "two"], [1, "one"], [i, "i"], [-1, "m"], [1.5, "h"]]), symbols: () => new Map([[s, 1], [Symbol.iterator, 2]]),
  objects: i => new Map([[{ toString: () => "o" + i }, 1], [[1, 2], 2], [null, 3], [undefined, 4], [true, 5], [10n, 6]]), bad: () => new Map([["a", 1], [badKey, 2], ["c", 3]]),
  proto: i => new Map([["__proto__", { up: i }], ["constructor", 1], ["toString", 2]]), twice: i => [["a", 1], ["b", 2], ["a", i]], sub: i => new M([["a", i]]), own: () => new Own([["x", 1]]), changedMap: () => changedMap, changedList: () => changedList,
  array: i => [["a", i], ["b", 2.5], ["c", "x"]], none: () => [], holes: () => [["a", 1], , ["c", 2]], texts: () => ["ab", "cd"], numbersIn: () => [["a", 1], 5], nulls: () => [["a", 1], null], short: () => [["a"], []], long: () => [["a", 1, 2, 3]], things: i => [{ 0: "k" + i, 1: i }, { 1: 1 }], listsOfLists: () => L.from([["a", 1], ["b", 2]]),
  doubles: () => [[0.5, 1.5], [1, 2]], set: i => new Set([["a", i], ["b", 2]]), keys: () => new Map([["ab", 1]]).keys(), entries: i => Object.entries({ q: i, r: "x" }), mapEntries: i => new Map([["m", i]]).entries(), listEntries: () => ["x", "y"].entries(), mapped: i => [1, 2].map(x => ["k" + x, x * i]),
  generator: function* (i) { yield ["g", i]; yield ["h", 2]; }, generatorBad: function* () { try { yield ["g", 1]; yield 5; yield ["h", 2]; } finally { log.push("closed"); } }, search: () => new URLSearchParams("a=1&b=2&a=3"), text: () => "ab", number: () => 5, nul: () => null, undef: () => undefined, plain: () => ({ a: 1 }), none2: () => ({ [Symbol.iterator]: 5 }),
  counted: i => counted([["a", i], ["b", 2]]), countedBad: () => counted([["a", 1], "ab", ["b", 2]]), countedKey: () => counted([["a", 1], [badKey, 2]]), countedValue: () => counted([["a", 1], thrower]), loud: () => [loudEntry, loudEntry], loudMap: () => new Map([[loudEntry, loudEntry]]), thrower: () => [["a", 1], thrower, ["b", 1]], typed: () => new Uint8Array(2), args: function () { return (function () { return arguments; })(["a", 1], ["b", 2]); },
  grows: () => { const m = new Map([["a", { toString() { return "x"; } }]]); m.set({ toString() { if (m.size < 5) m.set("new" + m.size, 1); return "grew"; } }, 2); return m; }, shrinks: () => { const m = new Map(); m.set({ toString() { m.delete("gone"); return "first"; } }, 1); m.set("gone", 2); m.set("kept", 3); return m; },
  listGrows: () => { const l = [["a", 1]]; l.push([{ toString() { if (l.length < 4) l.push(["more" + l.length, l.length]); return "k"; } }, 2]); return l; }, listShrinks: () => { const l = [["a", 1]]; l.push([{ toString() { l.length = 2; return "k"; } }, 2], ["gone", 3]); return l; }, becomesDoubles: () => { const l = [[{ toString() { l[1] = 1.5; return "k"; } }, 2], ["x", 1]]; return l; },
};
function direct(i, name) { return Object.fromEntries(makers[name](i)); }
function given(x) { return Object.fromEntries(x); }
const passed = Object.fromEntries;
function loop(name) { let t = ""; for (let i = 0; i < 4; i++) { const o = Object.fromEntries(makers[name](i)); t += Object.keys(o).length + Object.keys(o).join(""); } return t; }
function maps(n) { let r = 0; for (let j = 0; j < n; j++) { const m = new Map([["a", j], ["b", 2]]); const o = Object.fromEntries(m); r += o.a + o.b; } return r; }
function lists(n) { let r = 0; for (let j = 0; j < n; j++) { const o = Object.fromEntries([["a", j], ["b", 2]]); r += o.a + o.b; } return r; }
function back(n) { let r = ""; for (let j = 0; j < n; j++) { const o = Object.fromEntries(Object.entries({ x: j, y: 2 }).map(([k, v]) => [k + k, v * 2])); r += JSON.stringify(o); } return r; }
function filtered(m) { return Object.fromEntries([...m].filter(([k, v]) => v > 1)); }
for (let turn = 0; turn < 3; turn++) for (const name of Object.keys(makers)) {
  console.log(name, attempt(() => direct(turn, name)), attempt(() => given(makers[name](turn))), attempt(() => passed(makers[name](turn))), attempt(() => [makers[name](turn)].map(Object.fromEntries)[0]), log.splice(0).join(""));
  let t; try { t = loop(name); } catch (e) { t = e.name; } console.log(t, log.splice(0).join(""));
}
console.log(maps(40), lists(40), back(4), show(filtered(new Map([["a", 1], ["b", 2], ["c", 3]]))));
const descriptor = Object.getOwnPropertyDescriptor(Object.fromEntries(new Map([["k", 1]])), "k"); console.log(JSON.stringify(descriptor));
