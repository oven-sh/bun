// RUN: lower
// OPTIONS: builtin-modules

// A pattern runs past the end and then the list grows.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function aDefaultGrows(list) {
  const [a, b = list.push("x", "y", "z"), c, d = "default d"] = list;
  return [a, b, c, d];
}

function aDefaultGrowsBeforeARest(list) {
  const [a, b = list.push("x", "y", "z"), ...rest] = list;
  return [a, b, rest];
}

function aDefaultStoresAhead(list) {
  const [a, b = (list[2] = "stored"), c] = list;
  return [a, b, c];
}

function aDefaultSetsTheLength(list) {
  const [a, b = (list.length = 4), c, d] = list;
  return [a, b, c, d, 2 in list];
}

function aSetterGrows(list) {
  const target = {
    set grow(value) {
      list.push("x", "y", "z");
    },
  };
  let a, c;
  [a, target.grow, c] = list;
  return [a, c];
}

function aSetterGrowsEarly(list) {
  const target = {
    set grow(value) {
      list.push("x", "y");
    },
  };
  let b, c, d;
  [target.grow, b, c, d] = list;
  return [b, c, d];
}

function aNestedPatternGrows(list) {
  const [a, [b] = [list.push("x", "y", "z")], c] = list;
  return [a, b, c];
}

function aParameterDefaultGrows([a, b = a.push("x", "y"), c], list) {
  return [b, c];
}

function anEmptyListGrows(list) {
  const [a = list.push("x", "y"), b, c = "default c"] = list;
  return [a, b, c];
}

function shrinksAndGrows(list) {
  const [a, b = ((list.length = 0), list.push("p", "q", "r", "s")), c, d] = list;
  return [a, b, c, d];
}

function twoPatterns(list) {
  const [a, b = list.push("x", "y", "z")] = list;
  const [c, d, e] = list;
  return [a, b, c, d, e];
}

const uses = { aDefaultGrows, aDefaultGrowsBeforeARest, aDefaultStoresAhead, aDefaultSetsTheLength, aSetterGrows, aSetterGrowsEarly, aNestedPatternGrows, anEmptyListGrows, shrinksAndGrows, twoPatterns };

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, [2], 3, 4, 5]);

const makers = {
  "five elements": () => [1, [2], 3, 4, 5],
  "one element": () => [1],
  "no elements": () => [],
  "one element and a hole": () => [1, ,],
  "one element and undefined": () => [1, undefined],
  "one double": () => [1.5],
  "one string": () => ["one"],
  "a subclass with one element": () => new (class extends Array {})(1).fill(1),
  "an array-like iterated as an array": () => ({ length: 1, 0: 1, push: Array.prototype.push, [Symbol.iterator]: Array.prototype.values }),
};

for (const name in makers) {
  for (const use in uses) {
    const list = makers[name]();
    attempt(name + ", " + use, () => uses[use](list));
    console.log("  left " + describe(list));
  }
}

function aDefaultThatLooksPure(list, factor) {
  const [a, b = factor * 2, c, d = "default d"] = list;
  return [a, b, c, d];
}

function aDefaultThatReadsAMember(list, holder) {
  const [a, b = holder.fallback, c] = list;
  return [a, b, c];
}

function intoMembers(list, target) {
  [target.a, target.b, target.c] = list;
  return [target.a, target.c];
}

function aDefaultThatConcatenates(list, suffix) {
  const [a, b = "b" + suffix, ...rest] = list;
  return [a, b, rest];
}

for (let i = 0; i < 1000; i++) {
  aDefaultThatLooksPure([1], 2);
  aDefaultThatReadsAMember([1], { fallback: 2 });
  intoMembers([1], { a: 0, b: 0, c: 0 });
  aDefaultThatConcatenates([1], "!");
}

attempt("a factor whose valueOf grows the list", () => {
  const list = [1];
  return aDefaultThatLooksPure(list, { valueOf: () => list.push("x", "y", "z") });
});
attempt("a member whose getter grows the list", () => {
  const list = [1];
  return aDefaultThatReadsAMember(list, { get fallback() { return list.push("x", "y", "z"); } });
});
attempt("a member whose setter grows the list", () => {
  const list = [1];
  return intoMembers(list, { a: 0, set b(value) { list.push("x", "y", "z"); }, c: 0 });
});
attempt("a proxy whose set trap grows the list", () => {
  const list = [1];
  return intoMembers(list, new Proxy({}, { set(target, key, value) { if (key === "b") list.push("x", "y", "z"); target[key] = value; return true; } }));
});
attempt("a suffix whose toString grows the list", () => {
  const list = [1];
  return aDefaultThatConcatenates(list, { toString: () => String(list.push("x", "y", "z")) });
});
attempt("the same functions with plain values again", () => [aDefaultThatLooksPure([1], 2), aDefaultThatReadsAMember([1], { fallback: 2 }), intoMembers([1], { a: 0, b: 0, c: 0 }), aDefaultThatConcatenates([1], "!")]);

attempt("a parameter pattern", () => {
  const inner = [];
  return aParameterDefaultGrows([inner], inner);
});

function growingView() {
  const buffer = new ArrayBuffer(1, { maxByteLength: 8 });
  const view = new Uint8Array(buffer);
  view[0] = 7;
  return view;
}

attempt("a typed array that grows", () => {
  const view = growingView();
  const [a, b = (view.buffer.resize(4), view.fill(9), "grown"), c, d] = view;
  return [a, b, c, d];
});

attempt("a typed array that grows before a rest", () => {
  const view = growingView();
  const [a, b = (view.buffer.resize(4), "grown"), ...rest] = view;
  return [a, b, rest];
});

attempt("a Set that grows", () => {
  const set = new Set([1]);
  const [a, b = set.add(2).add(3).size, c] = set;
  return [a, b, c];
});

attempt("a Map that grows", () => {
  const map = new Map([[1, 1]]);
  const [a, b = map.set(2, 2).size, c] = map;
  return [a, b, c];
});

// GENERATED: intoMembers growingView fallback set
// CHECK-LABEL: function {{*}}name="intoMembers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array, v1: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: v2 = IteratorOpen v0 elementCount=3 [isDestructuring]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3():
// CHECK-NEXT: v3 = IteratorResume v2 stepIndex=0
// CHECK-NEXT: v4 = ResultAt v3
// CHECK-NEXT: v5 = ResultAt v3 index=1
// CHECK-NEXT: PropSet v1, v5 key="a"
// CHECK-NEXT: v7 = IteratorResume v2 stepIndex=1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: PropSet v1, v9 key="b"
// CHECK-NEXT: v11 = IteratorResume v2 stepIndex=2
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: PropSet v1, v13 key="c"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: IteratorClose v2
// CHECK-NEXT: v16 = PropGet v1 key="a"
// CHECK-NEXT: v17 = PropGet v1 key="c"
// CHECK-NEXT: v18 = NewArray v16, v17 contents=anything
// CHECK-NEXT: Return v18
// CHECK-NEXT: b3() role=IterationCleanup subject=v2:
// CHECK-NEXT: v19 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="growingView"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = Construct v0, -, v1, v2 calleeName="ArrayBuffer"
// CHECK-NEXT: v4 = Builtin builtin=Uint8Array
// CHECK-NEXT: v5 = Construct v4, -, v3 calleeName="Uint8Array"
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Integer integer=7
// CHECK-NEXT: ElemSet v5, v6, v7
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fallback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=anything variableName="list"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="push"
// CHECK-NEXT: v2 = String string="x"
// CHECK-NEXT: v3 = String string="y"
// CHECK-NEXT: v4 = String string="z"
// CHECK-NEXT: v5 = Call v1, v0, v2, v3, v4 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=anything variableName="list"}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|string|symbol, v3: anything):
// CHECK-NEXT: v4 = String string="b"
// CHECK-NEXT: v5 = StrictEq v2, v4
// CHECK-NEXT: Branch v5 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = PropGet v0 key="push"
// CHECK-NEXT: v7 = String string="x"
// CHECK-NEXT: v8 = String string="y"
// CHECK-NEXT: v9 = String string="z"
// CHECK-NEXT: v10 = Call v6, v0, v7, v8, v9 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: ElemSet v1, v2, v3
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
