// new Map and new Set of lists that are written in the call: order of evaluation, equal keys, entries that are no objects, replaced set and add, classes below them.
const log = [];
const note = (label, value) => (log.push(label), value);
const text = value => (typeof value === "function" ? "function " + JSON.stringify(value.name) : Object.is(value, -0) ? "-0" : typeof value === "symbol" || typeof value === "bigint" ? String(value) : value === undefined ? "undefined" : Number.isNaN(value) ? "NaN" : JSON.stringify(value));
const show = (label, collection) => {
  const entries = collection instanceof Map ? [...collection].map(([key, value]) => text(key) + "=>" + text(value)) : [...collection].map(text);
  console.log(label, collection.constructor.name, collection.size, entries.join(" "), "|", log.splice(0).join());
};
const attempt = (label, run) => {
  try {
    show(label, run());
  } catch (error) {
    console.log(label, "throws", error.constructor.name, error.message.replace(/ \(evaluating.*$/, ""), "|", log.splice(0).join());
  }
};
const a = { id: "a" }, b = { id: "b" };

attempt("map of two", () => new Map([["x", note("x", a)], ["y", note("y", b)]]));
attempt("map: order of evaluation", () => new Map([[note("k1", a), note("v1", 1)], [note("k2", b), note("v2", 2)]]));
attempt("map: a key twice keeps its first place", () => new Map([[a, 1], [b, 2], [a, 3]]));
attempt("map: NaN is one key, -0 is 0", () => new Map([[NaN, a], [0 / 0, b], [-0, a], [0, b]]));
attempt("map: 1 and '1' are two keys", () => new Map([[1, a], ["1", b], [1n, a], [true, b], [null, a], [undefined, b]]));
attempt("map: more than two in a pair", () => new Map([[a, note("v", 1), note("third", 2)]]));
attempt("map: a pair of one", () => new Map([[a], [b, 1]]));
attempt("map: an empty pair", () => new Map([[], [b, a]]));
attempt("map: a hole in a pair", () => new Map([[, a], [b, , 3]]));
attempt("map: a hole for a pair", () => new Map([[a, 1], , [b, 2]]));
attempt("map: a spread", () => new Map([...[[a, 1]], [b, 2]]));
attempt("map: a spread in a pair", () => new Map([[...[a, 1]], [b, 2]]));
attempt("map: a string for a pair", () => new Map([[a, 1], "ab"]));
attempt("map: an object for a pair", () => new Map([{ 0: a, 1: b }, [b, a]]));
attempt("map: no pair", () => new Map([]));
attempt("map: nothing", () => new Map());
attempt("map: null", () => new Map(null));
attempt("map: two arguments", () => new Map([[a, 1]], note("second", 2)));
attempt("map: a value throws", () => new Map([[note("k", a), 1], [b, (() => { throw new RangeError("no value"); })()], [note("never", a), 2]]));
attempt("map: functions get no name", () => new Map([["arrow", () => 1], ["plain", function () {}]]));
attempt("map: constants alone", () => new Map([["a", 1], ["b", 2], ["a", 3]]));
attempt("map: constants and one variable", () => new Map([["a", 1], ["b", a], ["c", 3]]));
attempt("map without new", () => Map([[a, 1]]));

attempt("set of two", () => new Set([note("a", a), note("b", b)]));
attempt("set: a value twice", () => new Set([a, b, a, b, a]));
attempt("set: NaN once, -0 is 0", () => new Set([NaN, 0 / 0, -0, 0, a]));
attempt("set: a hole", () => new Set([a, , b]));
attempt("set: a spread", () => new Set([...[a, b], a, ..."xy"]));
attempt("set: nothing in the list", () => new Set([]));
attempt("set: a string", () => new Set("aab"));
attempt("set: a value throws", () => new Set([note("first", a), (() => { throw new RangeError("no value"); })(), note("never", b)]));
attempt("set: constants alone", () => new Set(["a", "b", "a", 1, 1]));
attempt("set: lists are values", () => new Set([[a], [a]]));
attempt("set without new", () => Set([a]));

class Counted extends Map {
  set(key, value) {
    note("set " + text(key));
    return super.set(key, value);
  }
}
attempt("a class below Map has its own set", () => new Counted([[a, 1], [b, 2]]));
class Tagged extends Set {
  add(value) {
    note("add " + text(value));
    return super.add(value);
  }
}
attempt("a class below Set has its own add", () => new Tagged([a, b]));
attempt("Reflect.construct for a class below", () => Reflect.construct(Map, [[[a, 1]]], Counted));
{
  const Map = class { constructor(list) { this.size = list.length; } *[Symbol.iterator]() {} };
  const Set = function (list) { return { size: "mine " + list.length, constructor: { name: "Own" }, [Symbol.iterator]: function* () {} }; };
  console.log("another Map", new Map([[a, 1], [b, 2]]).size, "another Set", new Set([a, b]).size);
}
function shadowed(Map, Set) {
  return [new Map([[a, 1]]), new Set([a])];
}
console.log("parameters named Map and Set", JSON.stringify(shadowed(function (list) { return { map: list.length }; }, function (list) { return { set: list.length }; })));

const weak = new WeakMap([[a, note("weak", 1)], [b, 2]]);
console.log("a weak map", weak.get(a), weak.get(b), weak.has({}), log.splice(0).join());
const weakSet = new WeakSet([a, b]);
console.log("a weak set", weakSet.has(a), weakSet.has({}));

const many = [];
for (let turn = 0; turn < 300; turn++) many.push(new Map([["turn", turn], [turn, many.length]]), new Set([turn, turn % 7, many]));
let sum = 0;
for (const collection of many) sum += collection.size + (collection instanceof Map ? collection.get("turn") : collection.has(3) ? 1 : 0);
console.log("each evaluation makes its own", sum, many[0] !== many[2]);

const handlers = new Map([["add", (x, y) => x + y], ["sub", (x, y) => x - y], ["neg", x => -x]]);
console.log("a table of functions", handlers.get("add")(1, 2), handlers.get("sub")(1, 2), handlers.get("neg")(1), handlers.get("none"));
const grown = new Map([[a, 1]]);
for (let index = 0; index < 100; index++) grown.set(index, index);
grown.delete(a);
console.log("it grows and shrinks", grown.size, grown.get(99), grown.has(a));
function* yields() {
  return new Set([yield 1, yield 2]);
}
const generator = yields();
generator.next();
generator.next(a);
show("values that are yielded", generator.next(b).value);
