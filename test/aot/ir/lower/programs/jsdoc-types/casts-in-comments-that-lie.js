// RUN: lower
// OPTIONS: builtin-modules

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ kind: "circle", r: number } | { kind: "square", side: number }} Shape */

class Animal {
  legs = 4;
}

class Dog extends Animal {
  name = "rex";
  /** @returns {string} */
  bark() {
    return this.name + "!";
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

/**
 * @param {string} label
 * @param {() => unknown} run
 */
function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}

/**
 * @param {Point} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function asNumber(value) {
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} value
 * @returns {Point}
 */
function asPoint(value) {
  return /** @type {Point} */ (value);
}

/**
 * @param {Shape} shape
 * @returns {number}
 */
function radius(shape) {
  return /** @type {Extract<Shape, { kind: "circle" }>} */ (shape).r;
}

/**
 * @param {Animal} animal
 * @returns {string}
 */
function bark(animal) {
  return /** @type {Dog} */ (animal).bark();
}

/**
 * @param {Animal} animal
 * @returns {string}
 */
function nameOf(animal) {
  return /** @type {Dog} */ (animal).name + "?";
}

/**
 * @param {number | undefined} n
 * @returns {number}
 */
function present(n) {
  return /** @type {number} */ (n) + 1;
}

/**
 * @param {string | number} v
 * @returns {number}
 */
function sizeOf(v) {
  return /** @type {string} */ (v).length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(asNumber(i)) + sum(asPoint({ x: i, y: 1 })) + radius({ kind: "circle", r: i }) + bark(new Dog()).length + present(i) + sizeOf("ab");
console.log("2000 honest rounds: " + warm);

for (const value of [1, "1", null, undefined, true, [1], { valueOf: () => 1 }, { x: 1, y: 2 }, { x: "1", y: "2" }, { y: 1 }]) {
  attempt("as a number, " + show(value), () => [asNumber(value) + 1, plusOne(asNumber(value)), typeof asNumber(value)]);
  attempt("as a point, " + show(value), () => [asPoint(value).x, sum(asPoint(value))]);
}

attempt("the radius of a square", () => [radius({ kind: "square", side: 2 }), radius({ kind: "square", side: 2 }) + 1]);
attempt("an animal barks", () => bark(new Animal()));
attempt("the name of an animal", () => nameOf(new Animal()));
attempt("present, and it is not", () => present(undefined));
attempt("the size of a number", () => [sizeOf(5), sizeOf(5) + 1]);

attempt("through unknown, in sight", () => {
  const n = /** @type {number} */ (/** @type {unknown} */ ("12"));
  const p = /** @type {Point} */ (/** @type {unknown} */ ([1, 2]));
  const f = /** @type {() => number} */ (/** @type {unknown} */ ({ call: 1 }));
  return [n + 1, typeof n, p.x, sum(p), typeof f];
});
attempt("a function that is none, called", () => /** @type {() => number} */ (/** @type {unknown} */ ({ call: 1 }))());
attempt("a list that is a text", () => {
  const list = /** @type {number[]} */ (/** @type {unknown} */ ("12"));
  let total = 0;
  for (const n of list) total += n;
  return [total, list.length];
});
attempt("an empty literal as a point", () => {
  const p = /** @type {Point} */ ({});
  const before = [p.x, sum(p), Object.keys(p).join()];
  p.y = 2;
  p.x = 1;
  return [before, sum(p), Object.keys(p).join()];
});
attempt("const, and then stored to through another name", () => {
  const fixed = /** @type {const} */ ({ level: 3 });
  /** @type {{ level: number }} */
  const open = fixed;
  open.level = 4;
  return [fixed.level, fixed.level === 3, fixed.level + 1];
});

console.log("honest again: " + [plusOne(asNumber(1)), sum(asPoint({ x: 1, y: 2 })), bark(new Dog())].join(" "));

export {};

// GENERATED: attempt Animal Dog valueOf
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|[[f_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Animal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
