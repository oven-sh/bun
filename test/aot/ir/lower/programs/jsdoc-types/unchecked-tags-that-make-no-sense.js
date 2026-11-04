// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
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

/** @type {Missing} */
const unknownName = 1;

/** @type {import("./nowhere.js").Gone} */
const unknownModule = "text";

/** @type {number */
const unclosed = "unclosed";

/** @type {} */
const noType = "no type";

/** @type */
const bare = "bare";

/** @type {number} @type {string} */
const two = true;

/** @type {number<string>} */
const notGeneric = "generic";

/** @type {Array} */
const rawArray = "raw";

/** @type {Promise} */
const rawPromise = 5;

/** @type {Object} */
const rawObject = 6;

/** @type {Function} */
const rawFunction = { not: "callable" };

/** @type {Number} */
const boxedName = "Number";

/** @type {String} */
const boxedText = 7;

/** @type {typeof missingValue} */
const typeOfNothing = 8;

/**
 * @param {number} wrongName
 * @param {string} alsoWrong
 */
function otherNames(a, b) {
  return [a + 1, b + 1];
}

/**
 * @param {string} b
 * @param {number} a
 */
function otherOrder(a, b) {
  return [a + 1, b + 1];
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
function tooMany(a) {
  return [a + 1, arguments.length];
}

/** @param {number} a */
function tooFew(a, b, c) {
  return [a + 1, b, c];
}

/**
 * @param {number} a
 * @param {string} a
 */
function twiceTheSame(a) {
  return a + 1;
}

/**
 * @returns {number}
 * @returns {string}
 */
function twoResults() {
  return true;
}

/**
 * @template T
 * @param {U} v
 * @returns {T}
 */
function wrongTemplate(v) {
  return v;
}

/** @type {number} */
function taggedAsANumber() {
  return "called";
}

/** @type {(a: string) => string} */
function taggedAsAnotherFunction(a, b) {
  return a + b;
}

/** @typedef {number} Size */
/** @typedef {string} Size */

/** @type {Size} */
const size = [1];

/** @typedef {Loop} Loop */

/** @type {Loop} */
const loop = "loop";

/** @extends {Missing} */
class Heir {
  value = 1;
}

/** @implements {Missing} */
class Doer {
  value = 2;
}

/** @this {Missing} */
function usesThis() {
  return typeof this;
}

/** @enum {Missing} */
const Kinds = { A: 1, B: "b" };

/** @satisfies {Missing} */
const satisfied = { a: 1 };

const cast = /** @type {Missing} */ ("cast");

attempt("names that do not exist", () => [unknownName + 1, unknownModule + "!", typeOfNothing + 1, cast + "!"]);
attempt("comments that cannot be read", () => [unclosed + "!", noType + "!", bare + "!", two, notGeneric + "!"]);
attempt("names without their operands", () => [rawArray + "!", rawPromise + 1, rawObject + 1, typeof rawFunction, boxedName + "!", boxedText + 1]);
attempt("what is tagged Function is called", () => rawFunction());
attempt("parameters under other names", () => [otherNames(1, 2), otherNames("1", "2"), otherOrder(1, "b"), otherOrder("a", 2)]);
attempt("too many and too few", () => [tooMany(1), tooMany(1, 2, 3), tooFew(1), tooFew(1, 2, 3), twiceTheSame(1), twiceTheSame("1")]);
attempt("results", () => [twoResults(), wrongTemplate(1) + 1, wrongTemplate("1") + 1]);
attempt("functions with a type tag", () => [taggedAsANumber(), typeof taggedAsANumber, taggedAsAnotherFunction(1, 2), taggedAsAnotherFunction("1", 2)]);
attempt("typedefs", () => [size + 1, loop + "!"]);
attempt("classes", () => [new Heir().value + 1, new Doer().value + 1, Object.getPrototypeOf(Heir) === Function.prototype]);
attempt("the rest", () => [usesThis.call(5), usesThis(), Kinds.A + 1, Kinds.B + 1, satisfied.a + 1]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: tooMany twoResults attempt Heir
// CHECK-LABEL: function {{*}}name="tooMany"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: number, v2: Array):
// CHECK-NEXT: v3 = CreateUnmappedArguments v0, v2, v1
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = PropGet v3 key="length"
// CHECK-NEXT: v7 = NewArray v5, v6 contents=anything
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twoResults"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
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
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
