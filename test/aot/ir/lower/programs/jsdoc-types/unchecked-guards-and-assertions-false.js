// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// Unchecked guards and assertions are false.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 0;
}

class Square extends Shape {
  edge = 2;
  /** @returns {number} */
  area() {
    return this.edge * this.edge;
  }
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isNumber(v) {
  return true;
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function isText(v) {
  return v !== null;
}

/**
 * @param {Shape} s
 * @returns {s is Square}
 */
function isSquare(s) {
  return s.sides === 0;
}

/**
 * @param {unknown} v
 * @returns {v is { x: number, y: number }}
 */
function isPoint(v) {
  return typeof v === "object";
}

/**
 * @param {unknown} v
 * @returns {v is number[]}
 */
function isList(v) {
  return Object(v).length !== undefined;
}

/**
 * @param {unknown} v
 * @returns {asserts v is number}
 */
function assertNumber(v) {}

/**
 * @param {unknown} v
 * @returns {asserts v}
 */
function assertPresent(v) {}

/**
 * @param {Shape} s
 * @returns {asserts s is Square}
 */
function assertSquare(s) {}

/** @param {unknown} v */
function plusOne(v) {
  return isNumber(v) ? v + 1 : "no number";
}

/** @param {unknown} v */
function size(v) {
  return isText(v) ? v.length : "no text";
}

/** @param {Shape} s */
function area(s) {
  return isSquare(s) ? [s.edge, s.edge * 2, s.area()] : "no square";
}

/** @param {Shape} s */
function edge(s) {
  return isSquare(s) ? [s.edge, s.edge * 2] : "no square";
}

/** @param {unknown} v */
function sum(v) {
  return isPoint(v) ? v.x + v.y : "no point";
}

/** @param {unknown} v */
function total(v) {
  if (!isList(v)) return "no list";
  let result = 0;
  for (let i = 0; i < v.length; i++) result += v[i];
  return result;
}

/** @param {unknown} v */
function asserted(v) {
  assertNumber(v);
  return [v + 1, v * 2, typeof v];
}

/** @param {{ x: number } | null | undefined} p */
function present(p) {
  assertPresent(p);
  return p.x;
}

/** @param {Shape} s */
function assertedEdge(s) {
  assertSquare(s);
  return [s.edge, s.edge * 2];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + edge(new Square())[1] + sum({ x: i, y: 1 }) + total([i]) + asserted(i)[0] + present({ x: i }) + assertedEdge(new Square())[0];
console.log("2000 honest rounds: " + warm);

attempt("a guard for numbers", () => [plusOne(1), plusOne("1"), plusOne(null), plusOne(undefined), plusOne([1]), plusOne({})]);
attempt("a guard for texts", () => [size("ab"), size([1, 2, 3]), size(5), size({ length: "long" }), size(null)]);
attempt("a guard for texts, undefined", () => size(undefined));
attempt("a guard for a subclass, its field", () => [edge(new Square()), edge(new Shape())]);
attempt("a guard for a subclass, its method", () => area(new Shape()));
attempt("a guard for points", () => [sum({ x: 1, y: 2 }), sum({ x: "1", y: 2 }), sum([1, 2]), sum({}), sum(5)]);
attempt("a guard for points, null", () => sum(null));
attempt("a guard for lists", () => [total([1, 2]), total("12"), total({ length: 2, 0: 1, 1: "2" }), total(() => 1), total(5)]);
attempt("an assertion for numbers", () => [asserted(1), asserted("1"), asserted(null), asserted([2])]);
attempt("an assertion that something is there", () => present({ x: 1 }));
attempt("an assertion that something is there, null", () => present(null));
attempt("an assertion that something is there, undefined", () => present(undefined));
attempt("an assertion for a subclass", () => [assertedEdge(new Square()), assertedEdge(new Shape())]);
attempt("a guard in filter", () => [1, "2", null, [3]].filter(isNumber).map(n => n + 1));
attempt("a guard in find", () => {
  const found = ["a", 1].find(isNumber);
  return [found, found + 1];
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: isNumber isSquare isList plusOne asserted Shape Square
// CHECK-LABEL: function {{*}}name="isNumber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isSquare"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="sides"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isList"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="Object"
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined
// CHECK-NEXT: v5 = LogicalNot v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|number|"no number" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="isNumber"
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = String string="no number"
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|"no number" flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="assertNumber"
// CHECK-NEXT: v3 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Mul v3, v6
// CHECK-NEXT: v8 = TypeOf v3
// CHECK-NEXT: v9 = NewArray v5, v7, v8 contents=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
