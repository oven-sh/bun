// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: yields note Counted set Set
// CHECK-LABEL: function {{*}}name="yields"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<int[1, 2]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=int[1, 2] flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Convert v8 declared={type=int[1, 2] flags=[IsExpected]}
// CHECK-NEXT: v10 = Yield v9
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b7():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = Builtin builtin=Set
// CHECK-NEXT: v15 = Construct v14 calleeName="Set"
// CHECK-NEXT: v16 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v17 = Call v16, v15, v6
// CHECK-NEXT: v18 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v19 = Call v18, v15, v11
// CHECK-NEXT: v20 = Convert v15 declared={type=undefined|null|Set flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=[[L_5]] flags=[IsExpected]} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_5]], v1: undefined|null|number|string|symbol|bigint|[[L_6]], v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="note"
// CHECK-NEXT: v5 = String string="set "
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="text"
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="text"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v5, v9
// CHECK-NEXT: v11 = Call v4, -, v10 calleeName="note"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v13 = GetSuperBase v12 homeKind=ClassPrototype
// CHECK-NEXT: v14 = SuperGet v13, v0 key="set"
// CHECK-NEXT: v15 = Call v14, v0, v1, v2 calleeName="super.set"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|[[L_5]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_10]] flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="mine "
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_10]]
// CHECK-NEXT: PropDefine v5, v4 key="size"
// CHECK-NEXT: v7 = Data data=[[d_12]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v8 key="constructor"
// CHECK-NEXT: v10 = NewClosure function=[[f_13]]
// CHECK-NEXT: PropDefine v5, v10 key=@@iterator
// CHECK-NEXT: v12 = FinishObject v5
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
