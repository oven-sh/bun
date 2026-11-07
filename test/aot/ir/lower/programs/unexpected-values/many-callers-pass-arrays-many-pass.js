// RUN: lower
// OPTIONS: builtin-modules

// Many callers pass arrays as many pass strings and one passes neither.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function size(value) {
  return value.length;
}

function firstOf(value) {
  return value[0];
}

function tail(value) {
  return value.slice(1);
}

function has(value, what) {
  return value.includes(what);
}

function where(value, what) {
  return value.indexOf(what);
}

function joinTwo(value, other) {
  return value.concat(other);
}

function lastOf(value) {
  return value.at(-1);
}

function count(value) {
  let n = 0;
  for (const item of value) n++;
  return n;
}

function add(a, b) {
  return a + b;
}

function less(a, b) {
  return a < b;
}

function honest(round) {
  console.log(round, "size", size([1, 2]), size("ab"), size([]), size(""), size(new Array(3)), size("abc"));
  console.log(round, "firstOf", firstOf([1, 2]), firstOf("ab"), firstOf([]), firstOf(""), firstOf(["x"]), firstOf("x"));
  console.log(round, "tail", show(tail([1, 2])), show(tail("ab")), show(tail([])), show(tail("")));
  console.log(round, "has", has([1, 2], 2), has("ab", "b"), has([], 1), has("", ""), has([NaN], NaN), has("ab", "c"));
  console.log(round, "where", where([1, 2], 2), where("ab", "b"), where([NaN], NaN), where("", ""));
  console.log(round, "joinTwo", show(joinTwo([1], [2])), show(joinTwo("a", "b")), show(joinTwo([1], 2)), show(joinTwo("a", 1)));
  console.log(round, "lastOf", lastOf([1, 2]), lastOf("ab"), lastOf([]), lastOf(""));
  console.log(round, "count", count([1, 2]), count("ab"), count([]), count("\u{1f600}"));
  console.log(round, "add", add(1, 2), add("a", "b"), add(0.5, 0.5), add("", ""), add(-1, 1), add("x", "y"));
  console.log(round, "less", less(1, 2), less("a", "b"), less(2, 1), less("b", "a"), less("10", "9"), less(10, 9));
}

const neither = [
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a String object", () => new String("ab")],
  ["an arguments object", () => (function () { return arguments; })(1, 2)],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["an object with every method", () => ({ length: "its own", 0: "its own", slice: () => "its own", includes: () => "its own", indexOf: () => "its own", concat: () => "its own", at: () => "its own", [Symbol.iterator]: () => [1, 2, 3][Symbol.iterator]() })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a Set", () => new Set([1, 2])],
  ["a function", () => function (a, b) {}],
  ["a number", () => 12],
  ["null", () => null],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of neither) {
  attempt("size of " + name, () => size(make()));
  attempt("firstOf " + name, () => firstOf(make()));
  attempt("tail of " + name, () => tail(make()));
  attempt("has, " + name, () => has(make(), 2));
  attempt("where, " + name, () => where(make(), 2));
  attempt("joinTwo, " + name, () => joinTwo(make(), [3]));
  attempt("lastOf " + name, () => lastOf(make()));
  attempt("count of " + name, () => count(make()));
}
const mixed = [[1, "2"], ["1", 2], [1, 2n], [1n, 2n], [[1], [2]], [{}, 1], [null, 1], [undefined, "a"], [1, null], ["a", Symbol.iterator], [true, true], [-0, -0], [new Date(0), 1], ["10", 9], [10, "9"], ["a", 1], [NaN, NaN], [1n, 2], [1n, "2"], [[2], 10]];
for (const [a, b] of mixed) {
  const label = (typeof a === "object" ? JSON.stringify(a) : show(a)) + " and " + (typeof b === "object" ? JSON.stringify(b) : show(b));
  attempt("add " + label, () => (a instanceof Date ? typeof add(a, b) : add(a, b)));
  attempt("less " + label, () => less(a, b));
}
attempt("an array and a string", () => [joinTwo([1], "a"), joinTwo("a", [1]), has(["ab"], "a"), has("ab", ["a"]), where("1,2", [1, 2])]);
honest("after");

// GENERATED: firstOf tail count add less slice [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="firstOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="slice" calleeName="value.slice"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Increment v4
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v12 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="less"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Less v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="slice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="its own"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_2]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key=@@iterator
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_2]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
