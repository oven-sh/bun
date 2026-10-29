// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// Unchecked never void and literal types are false.
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

/** @returns {never} */
function fail() {
  return "came back";
}

/** @returns {never} */
const failArrow = () => 1;

class Thrower {
  /** @returns {never} */
  fail() {
    return "came back";
  }
}

function afterACall() {
  fail();
  return "the statement after the call ran";
}

function afterAMethod() {
  new Thrower().fail();
  return "the statement after the method ran";
}

function resultOfNever() {
  const result = fail();
  return [result, typeof result, result + "!"];
}

/** @param {number | undefined} n */
function narrowedByNever(n) {
  if (n === undefined) fail();
  return n + 1;
}

/** @param {string | number} v */
function bothBranches(v) {
  if (typeof v === "string") return "text";
  if (typeof v === "number") return "number";
  return "neither: " + typeof v;
}

/** @param {"a" | "b"} mode */
function exhaustive(mode) {
  switch (mode) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
  return "fell through with " + mode;
}

function loopThatNeverEnds() {
  let rounds = 0;
  for (;;) {
    rounds++;
    if (rounds === 3) break;
    fail();
  }
  return rounds;
}

/** @type {never} */
const impossible = "here";

/** @type {void} */
const empty = 3;

/** @type {null} */
const nil = { x: 1 };

/** @type {undefined} */
const missing = 7;

/** @type {5} */
const five = 6;

/** @type {true} */
const on = false;

/** @type {false} */
const off = 1;

/** @type {"a"} */
const mode = "b";

/** @type {1 | 2} */
const level = 3;

/** @type {0} */
const zero = -0;

/** @type {{ kind: "fixed", size: 4 }} */
const fixed = { kind: "loose", size: 5 };

/** @type {readonly [1, 2]} */
const pair = [3, 4, 5];

/** @type {unique symbol} */
const unique = "no symbol";

/** @param {5} n */
function takesFive(n) {
  return [n, n + 1, n === 5];
}

/** @param {true} flag */
function takesTrue(flag) {
  return flag ? "then" : "else";
}

/** @returns {5} */
function givesFive() {
  return 6;
}

attempt("after a call that never returns", afterACall);
attempt("after a method that never returns", afterAMethod);
attempt("after an arrow that never returns", () => {
  failArrow();
  return "the statement after the arrow ran";
});
attempt("the result of never", resultOfNever);
attempt("narrowed by never", () => [narrowedByNever(1), narrowedByNever(undefined)]);
attempt("neither branch", () => [bothBranches("a"), bothBranches(1), bothBranches(true), bothBranches(null)]);
attempt("an exhaustive switch", () => [exhaustive("a"), exhaustive("b"), exhaustive("c"), exhaustive(1)]);
attempt("a loop", loopThatNeverEnds);
attempt("a value of type never", () => [typeof impossible, impossible, impossible + "!", impossible.length]);
attempt("a value of type void", () => [typeof empty, empty, empty + 1, empty === undefined]);
attempt("a value of type null", () => [typeof nil, nil === null, nil == null, nil ?? "fallback", nil ? "truthy" : "falsy", nil?.x]);
attempt("a value of type undefined", () => [typeof missing, missing === undefined, missing ?? "fallback", missing + 1, missing ? "truthy" : "falsy"]);
attempt("five", () => [five, five + 1, five === 5, five === 6, five * 2, [0, 1, 2, 3, 4, 5, 6][five], `${five}`]);
attempt("true and false", () => [on, on === true, !on, on ? "then" : "else", off, off === false, !off, off ? "then" : "else", on && "and", off || "or"]);
attempt("a text", () => [mode, mode === "a", mode === "b", mode + "!", mode.length, { a: 1, b: 2 }[mode]]);
attempt("a level", () => [level, level === 1 ? "one" : "two", level + 1]);
attempt("zero", () => [zero, Object.is(zero, 0), 1 / zero]);
attempt("a literal of literals", () => [fixed.kind, fixed.kind === "fixed", fixed.size, fixed.size + 1, fixed.size === 4, JSON.stringify(fixed)]);
attempt("a pair", () => [pair[0], pair[1], pair[0] + pair[1], pair.length, pair.length === 2, pair[2]]);
attempt("a symbol", () => [typeof unique, unique + "!", { [unique]: 1 }]);
attempt("parameters", () => [takesFive(5), takesFive(6), takesFive("5"), takesTrue(true), takesTrue(false), takesTrue(0), takesTrue("no")]);
attempt("a result", () => [givesFive(), givesFive() + 1, givesFive() === 5]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: exhaustive attempt Thrower
// CHECK-LABEL: function {{*}}name="exhaustive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"a"|"b" flags=[IsExpected]}] results=[{type=undefined|null|int[1, 2]|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|"a"|"b"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["a", "b"] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|int[1, 2]|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|int[1, 2]|string flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v7 = String string="fell through with "
// CHECK-NEXT: v8 = Add v7, v0
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|int[1, 2]|string flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
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
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|number|string|bigint|Array flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v9, -, v11 calleeName="show"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Call v6, v4, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string=" threw "
// CHECK-NEXT: v23 = Add v0, v22
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="Error" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v27 = InstanceOf v16, v26 writtenExpression="error instanceof Error"
// CHECK-NEXT: v28 = ToBoolean v27
// CHECK-NEXT: Branch v28 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v29):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v30 = Convert v16 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="constructor"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="name"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v34)
// CHECK-NEXT: b7(v35):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v36 = TypeOf v16
// CHECK-NEXT: Jump -> next b9(v36)
// CHECK-NEXT: b9(v37):
// CHECK-NEXT: v38 = Add v23, v37
// CHECK-NEXT: v39 = Call v21, v19, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Thrower"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
