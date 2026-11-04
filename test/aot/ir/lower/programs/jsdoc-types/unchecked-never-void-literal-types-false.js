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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"a"|"b" flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|"a"|"b"):
// CHECK-NEXT: SwitchString v0 strings=["a", "b"] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = String string="fell through with "
// CHECK-NEXT: v6 = Add v5, v0
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
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
// CHECK-LABEL: function {{*}}name="Thrower"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
