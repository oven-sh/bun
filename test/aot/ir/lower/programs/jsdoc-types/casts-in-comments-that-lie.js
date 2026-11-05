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
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
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
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Animal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
