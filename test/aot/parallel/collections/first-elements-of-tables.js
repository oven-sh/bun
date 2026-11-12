// The first elements of sets, maps and others, by pattern and by next().
// STATISTIC: IteratorAllocationsElidedInSteps >= 10
const all = process.argv[2] === "all"; let lines = 0, hash = 0, log = ""; const more = process.argv.length > 90 ? 1 : 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 260)); else if (lines % 23 === 0) console.log(lines, hash); }
function show(x) { return Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "symbol" ? "symbol" : typeof x === "function" ? "function" : Array.isArray(x) ? "[" + x.map(show).join() + "]" : typeof x === "object" && x ? (x.id !== undefined ? "#" + x.id : x.constructor?.name + "{}") : String(x); }
class OwnSet extends Set { values() { log += "v"; return ["s", 5].values(); } [Symbol.iterator]() { log += "i"; return super.values(); } }
class HeirSet extends Set { extra = 1; }
class HeirMap extends Map { extra = 1; }
class OwnMap extends Map { keys() { log += "k"; return [7, 8].values(); } entries() { log += "e"; return super.entries(); } }
class Steps { at = 0; next() { log += "n"; return { done: this.at > 2, value: this.at++ }; } return() { log += "r"; return {}; } [Symbol.iterator]() { return this; } values() { return this; } keys() { return this; } entries() { return this; } }
const objects = [{ id: 1 }, { id: 2 }, { id: 3 }];
const CONST = new Set(["a", "b", "c", 4]);
function deletedFront(n, k) { const s = new Set(); for (let i = 0; i < n; i++) s.add(i); for (let i = 0; i < k; i++) s.delete(i); return s; }
const makers = {
  ints: () => new Set([3, 1, 2]), one: () => new Set([9]), none: () => new Set(), texts: () => new Set(["x", "y", "a long text"]), mixed: () => new Set([0.5, "t", null, undefined, true, NaN, -0, 1n, Symbol.iterator]), undef: () => new Set([undefined, 1]),
  objects: () => new Set(objects), doubles: () => new Set([0.25, 1.5, 2 ** 40, -1e300]), big: () => new Set(Array.from({ length: 300 }, (_, i) => i)), bigTexts: () => new Set(Array.from({ length: 70 }, (_, i) => "k" + i)),
  deleted1: () => deletedFront(4, 1), deleted: () => deletedFront(64, 50), deletedAll: () => deletedFront(64, 64), deletedMost: () => deletedFront(200, 199), cleared: () => { const s = new Set([1, 2]); s.clear(); return s; }, refilled: () => { const s = new Set([1, 2]); s.clear(); s.add("z"); s.add("y"); return s; },
  again: () => { const s = new Set([1, 2, 3]); s.delete(1); s.add(1); return s; }, middle: () => { const s = new Set([1, 2, 3, 4]); s.delete(2); s.delete(3); return s; }, constant: () => new Set(CONST), module: () => CONST, copy: () => new Set(new Set([5, 6])), union: () => new Set([1]).union(new Set([2])),
  grown: () => { const s = new Set(); for (let i = 0; i < 40; i++) { s.add(i); if (i > 8) s.delete(i - 8); } return s; }, frozen: () => Object.freeze(new Set([1, 2])), named: () => Object.assign(new Set([4, 5]), { name: 1 }),
  own: () => new OwnSet([1, 2]), heir: () => new HeirSet([1, 2, 3]), ownIterator: () => Object.assign(new Set([1, 2]), { [Symbol.iterator]() { log += "o"; return [7, 8][Symbol.iterator](); } }), ownValues: () => Object.assign(new Set([1, 2]), { values() { log += "w"; return ["ow"].values(); } }),
  proto: () => Object.setPrototypeOf(new Set([1, 2]), { [Symbol.iterator]() { return ["p"][Symbol.iterator](); }, values() { return ["pv"].values(); }, keys() { return ["pk"].values(); }, entries() { return [["pe", 1]].values(); }, delete: () => true, size: 2, add() {}, clear() {} }),
  noProto: () => Object.setPrototypeOf(new Set([1, 2]), null), sameProto: () => Object.setPrototypeOf(new Set([6, 7]), Object.create(Set.prototype)), proxy: () => new Proxy(new Set([1, 2]), {}), bound: () => { const s = new Set([1, 2]); return new Proxy(s, { get: (t, k) => { log += "g"; const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } }); },
  map: () => new Map([[1, "one"], ["two", 2], [null, 3]]), emptyMap: () => new Map(), bigMap: () => new Map(Array.from({ length: 50 }, (_, i) => [i, "v" + i])), heirMap: () => new HeirMap([[1, 2], [3, 4]]), ownMap: () => new OwnMap([[1, 2], [3, 4]]), deletedMap: () => { const m = new Map([[1, 2], [3, 4], [5, 6]]); m.delete(1); return m; },
  list: () => [5, 6, , 8], emptyList: () => [], doublesList: () => [0.5, NaN], view: () => new Int8Array([4, 5]), text: () => "h\u{1F600}i", arguments: () => (function (..._) { return arguments; })(1, 2), steps: () => new Steps(), generator: () => (function* () { log += "y"; yield 1; try { yield 2; yield 3; } finally { log += "f"; } })(),
  iterator: () => new Set([1, 2, 3]).values(), mapIterator: () => new Map([[1, 2]]).entries(), weak: () => new WeakSet(), nothing: () => undefined, nil: () => null, number: () => 5, object: () => ({}), noMethod: () => ({ [Symbol.iterator]: 5 }), badNext: () => ({ [Symbol.iterator]() { return { next: 5 }; } }), badResult: () => ({ [Symbol.iterator]() { return { next() { return 5; } }; } }),
  thrower: () => ({ [Symbol.iterator]() { throw new RangeError("open"); } }), nextThrower: () => ({ [Symbol.iterator]() { return { next() { throw new RangeError("next"); }, return() { log += "R"; return {}; } }; } }), search: () => new URLSearchParams("a=1&b=2"), headers: () => new Headers({ a: "1" }),
};
function one(box) { const m = box.m; if (m === 77) return m; const [v] = m; return v; }
function two(box) { const m = box.m; if (m === 77) return m; const [v, w] = m; return show(v) + show(w); }
function five(box) { const m = box.m; if (m === 77) return m; const [a, b, c, d, e] = m; return [a, b, c, d, e]; }
function second(box) { const m = box.m; if (m === 77) return m; const [, v] = m; return v; }
function none(box) { const m = box.m; if (m === 77) return m; const [] = m; return "ok"; }
function withDefault(box) { const m = box.m; if (m === 77) return m; const [v = "d", w = "e"] = m; return show(v) + show(w); }
function rest(box) { const m = box.m; if (m === 77) return m; const [v, ...rest] = m; return show(v) + rest.length; }
function nested(box) { const m = box.m; if (m === 77) return m; const [[a, b] = ["x", "y"]] = m; return show(a) + show(b); }
function assigned(box) { const m = box.m; if (m === 77) return m; let a, b; [a, b] = m; return show(a) + show(b); }
function target(box) { const m = box.m; if (m === 77) return m; const o = {}; [o.a, o.b] = m; return show(o.a) + show(o.b); }
function spreadFirst(box) { const m = box.m; if (m === 77) return m; return [...m][0]; }
function valuesNext(box) { const m = box.m; if (m === 77) return m; return m.values().next().value; }
function keysNext(box) { const m = box.m; if (m === 77) return m; return m.keys().next().value; }
function entriesNext(box) { const m = box.m; if (m === 77) return m; return m.entries().next().value; }
function symbolNext(box) { const m = box.m; if (m === 77) return m; return m[Symbol.iterator]().next().value; }
function done(box) { const m = box.m; if (m === 77) return m; return m.values().next().done; }
function ofKeys(box) { const m = box.m; if (m === 77) return m; const [k] = m.keys(); return k; }
function ofValues(box) { const m = box.m; if (m === 77) return m; const [v, w] = m.values(); return show(v) + show(w); }
function inOne(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) { const [v] = m; s += show(v); } return s; }
function inTwo(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) { const [v, w] = m; s += show(v) + show(w); } return s; }
function inDefault(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) { const [v = i, , w = -i] = m; s += show(v) + show(w); } return s; }
function inValues(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) s += show(m.values().next().value); return s; }
function inKeys(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) s += show(m.keys().next().value); return s; }
function inEntries(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) s += show(m.entries().next().value); return s; }
function inKeysOfSet(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) s += show(m.keys().next().value); return s; }
function inValuesOfMap(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) s += show(m.values().next().value); return s; }
function inSymbol(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) s += show(m[Symbol.iterator]().next().value); return s; }
function inOptional(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) s += show(m?.values?.().next?.().value); return s; }
function inResult(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) { const r = m.values().next(); s += show(r.value) + r.done; } return s; }
function inBoth(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) { const it = m.values(); s += show(it.next().value) + show(it.next().value); } return s; }
function inCast(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) { const k = m.keys().next().value; if (k !== undefined) s += show(k); else s += "-"; } return s; }
function inNumber(box) { const m = box.m; if (m === 77) return m; let n = 0; for (let i = 0; i < 3 + more; i++) n += (m.keys().next().value) ?? 7; return n; }
function drain(box) { const m = box.m; if (m === 77) return m; let s = "", n = 0; while (m.size && n++ < 90) { const [x] = m; s += show(x); if (!m.delete(x)) break; } return s + m.size; }
function drainTwo(box) { const m = box.m; if (m === 77) return m; let s = "", n = 0; while (m.size > 1 && n++ < 90) { const [x, y] = m; s += show(x); m.delete(y); } return s + m.size; }
function drainValues(box) { const m = box.m; if (m === 77) return m; let s = "", n = 0; while (m.size && n++ < 90) { const x = m.values().next().value; s += show(x); if (!m.delete(x)) break; } return s + m.size; }
function drainKeys(box) { const m = box.m; if (m === 77) return m; let s = "", n = 0; while (m.size && n++ < 90) { const x = m.keys().next().value; s += show(x); if (!m.delete(x)) break; } return s + m.size; }
function drainFull(box) { const m = box.m; if (m === 77) return m; let s = "", n = 0; while (m.size && n++ < 400) { const [x] = m; s += show(x); if (!m.delete(x)) break; if (n % 3 === 0) m.add("a" + n); if (n === 50) m.clear(); } return s + m.size; }
function rotate(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 12 + more; i++) { const [x] = m; s += show(x); if (m.delete(x)) m.add(x); } return s; }
function clearing(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) { const [x] = m; s += show(x); if (i === 1) m.clear(); if (i === 2) m.add("late"); } return s; }
function replaced(box) { const m = box.m; if (m === 77) return m; let s = "", t = m; for (let i = 0; i < 4 + more; i++) { const [x] = t; s += show(x); if (i === 1) t = new Set(["T"]); if (i === 2) t = ["L"]; } return s; }
function patchedInTurn(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) { const [x] = m; s += show(x) + show(m.values().next().value); if (i === 1) { (m)[Symbol.iterator] = function () { return ["P"][Symbol.iterator](); }; (m).values = () => ["V"].values(); } } return s; }
function protoInTurn(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 4 + more; i++) { const [x] = m; s += show(x); if (i === 1) Object.setPrototypeOf(m, { [Symbol.iterator]() { return ["Q"][Symbol.iterator](); } }); } return s; }
function inTry(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 3 + more; i++) { try { const [x] = m; s += show(x); const y = m.values().next().value; s += show(y); } catch (e) { s += e.constructor.name; } finally { s += "/"; } } return s; }
function inCallback(box) { const m = box.m; if (m === 77) return m; let s = ""; [1, 2].forEach(() => { const [x] = m; s += show(x) + show(m.keys().next().value); }); return s; }
function inArguments(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 2 + more; i++) s += ((...a) => a.length)(...(m)); return s; }
function parameter(box) { const m = box.m; if (m === 77) return m; return (([a, b]) => show(a) + show(b))(m); }
function inParameter(box) { const m = box.m; if (m === 77) return m; let s = ""; for (let i = 0; i < 2 + more; i++) s += (([a, b]) => show(a) + show(b))(m); return s; }
function inOf(box) { const m = box.m; if (m === 77) return m; let s = ""; for (const [a] of [m, m]) s += show(a); return s; }
function collected(box) { const m = box.m; if (m === 77) return m; const [x] = m; const l = []; for (let i = 0; i < 2000; i++) l.push({ x }); const [y] = m; return show(x) + show(y) + l.length; }
function inOneL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) { const [v] = m; s.push(show(v)); } return s; }
function inTwoL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) { const [v, w] = m; s.push(show(v) + show(w)); } return s; }
function inDefaultL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) { const [v = i, , w = -i] = m; s.push(show(v) + show(w)); } return s; }
function inValuesL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) s.push(show(m.values().next().value)); return s; }
function inKeysL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) s.push(show(m.keys().next().value)); return s; }
function inEntriesL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) s.push(show(m.entries().next().value)); return s; }
function inKeysOfSetL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) s.push(show(m.keys().next().value)); return s; }
function inValuesOfMapL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) s.push(show(m.values().next().value)); return s; }
function inSymbolL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) s.push(show(m[Symbol.iterator]().next().value)); return s; }
function inOptionalL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) s.push(show(m?.values?.().next?.().value)); return s; }
function inResultL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) { const r = m.values().next(); s.push(show(r.value) + r.done); } return s; }
function inBothL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) { const it = m.values(); s.push(show(it.next().value) + show(it.next().value)); } return s; }
function inCastL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) { const k = m.keys().next().value; if (k !== undefined) s.push(show(k)); else s.push("-"); } return s; }
function drainL(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; while (m.size && n++ < 90) { const [x] = m; s.push(show(x)); if (!m.delete(x)) break; } return s.join() + m.size; }
function drainTwoL(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; while (m.size > 1 && n++ < 90) { const [x, y] = m; s.push(show(x)); m.delete(y); } return s.join() + m.size; }
function drainValuesL(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; while (m.size && n++ < 90) { const x = m.values().next().value; s.push(show(x)); if (!m.delete(x)) break; } return s.join() + m.size; }
function drainKeysL(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; while (m.size && n++ < 90) { const x = m.keys().next().value; s.push(show(x)); if (!m.delete(x)) break; } return s.join() + m.size; }
function drainFullL(box) { const m = box.m; if (m === 77) return m; const s = []; let n = 0; while (m.size && n++ < 400) { const [x] = m; s.push(show(x)); if (!m.delete(x)) break; if (n % 3 === 0) m.add("a" + n); if (n === 50) m.clear(); } return s.join() + m.size; }
function rotateL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 12 + more; i++) { const [x] = m; s.push(show(x)); if (m.delete(x)) m.add(x); } return s; }
function clearingL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) { const [x] = m; s.push(show(x)); if (i === 1) m.clear(); if (i === 2) m.add("late"); } return s; }
function replacedL(box) { const m = box.m; if (m === 77) return m; const s = []; let t = m; for (let i = 0; i < 4 + more; i++) { const [x] = t; s.push(show(x)); if (i === 1) t = new Set(["T"]); if (i === 2) t = ["L"]; } return s; }
function patchedInTurnL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) { const [x] = m; s.push(show(x) + show(m.values().next().value)); if (i === 1) { (m)[Symbol.iterator] = function () { return ["P"][Symbol.iterator](); }; (m).values = () => ["V"].values(); } } return s; }
function protoInTurnL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 4 + more; i++) { const [x] = m; s.push(show(x)); if (i === 1) Object.setPrototypeOf(m, { [Symbol.iterator]() { return ["Q"][Symbol.iterator](); } }); } return s; }
function inTryL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 3 + more; i++) { try { const [x] = m; s.push(show(x)); const y = m.values().next().value; s.push(show(y)); } catch (e) { s.push(e.constructor.name); } finally { s.push("/"); } } return s; }
function inCallbackL(box) { const m = box.m; if (m === 77) return m; const s = []; [1, 2].forEach(() => { const [x] = m; s.push(show(x) + show(m.keys().next().value)); }); return s; }
function inArgumentsL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 2 + more; i++) s.push(((...a) => a.length)(...(m))); return s; }
function inParameterL(box) { const m = box.m; if (m === 77) return m; const s = []; for (let i = 0; i < 2 + more; i++) s.push((([a, b]) => show(a) + show(b))(m)); return s; }
function inOfL(box) { const m = box.m; if (m === 77) return m; const s = []; for (const [a] of [m, m]) s.push(show(a)); return s; }
const names = { one, two, five, second, none, withDefault, rest, nested, assigned, target, spreadFirst, valuesNext, keysNext, entriesNext, symbolNext, done, ofKeys, ofValues, inOne, inTwo, inDefault, inValues, inKeys, inEntries, inKeysOfSet, inValuesOfMap, inSymbol, inOptional, inResult, inBoth, inCast, inNumber, drain, drainTwo, drainValues, drainKeys, drainFull, rotate, clearing, replaced, patchedInTurn, protoInTurn, inTry, inCallback, inArguments, parameter, inParameter, inOf, collected, inOneL, inTwoL, inDefaultL, inValuesL, inKeysL, inEntriesL, inKeysOfSetL, inValuesOfMapL, inSymbolL, inOptionalL, inResultL, inBothL, inCastL, drainL, drainTwoL, drainValuesL, drainKeysL, drainFullL, rotateL, clearingL, replacedL, patchedInTurnL, protoInTurnL, inTryL, inCallbackL, inArgumentsL, inParameterL, inOfL };
function boxed(m) { const box = JSON.parse('{"m":0}'); box.m = m; return box; }
function run(name, f) { log = ""; let r; try { r = show(f()); } catch (e) { r = "! " + e?.constructor?.name + (e instanceof RangeError ? " " + e.message : ""); } say(name + " " + r + " " + log); }
function every(turn) { for (const maker of Object.keys(makers)) for (const name of Object.keys(names)) { if (maker === "module" && /drain|rotate|clear|InTurn/.test(name)) continue; run(turn + maker + " " + name, () => names[name](boxed(makers[maker]()))); } }
every(""); every("2 ");
if (process.argv[3] === "patch" || process.argv[2] === "patch") {
  const step = Object.getPrototypeOf(new Set().values()), was = step.next;
  try { step.return = function () { log += "C"; return {}; }; every("return "); delete step.return; } catch (e) { say("return " + e.message); }
  try { step.next = function () { log += "N"; return was.call(this); }; every("next "); step.next = was; } catch (e) { say("next " + e.message); }
  try { (Set.prototype)[Symbol.iterator] = function () { log += "S"; return ["S"].values(); }; every("symbol "); } catch (e) { say("symbol " + e.message); }
  try { (Set.prototype).values = function () { log += "U"; return ["U"].values(); }; every("values "); } catch (e) { say("values " + e.message); }
  try { (Map.prototype).keys = function () { log += "K"; return ["K"].values(); }; every("keys "); } catch (e) { say("keys " + e.message); }
}
console.log("lines", lines, hash);
