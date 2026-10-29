// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// Unchecked type tags on variables are false.
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

const table = [10, 20, 30, 40];

/** @type {number} */
const text = "3";
attempt("a number that is a text", () => [typeof text, text + 1, text * 2, text | 0, text < 4, text === 3, table[text], `${text}`]);
attempt("a number that is a text, a method", () => text.toFixed(1));

/** @type {number} */
const nothing = null;
attempt("a number that is null", () => [typeof nothing, nothing + 1, nothing === null, nothing ?? "fallback", table[nothing]]);

/** @type {number} */
const absent = undefined;
attempt("a number that is undefined", () => [typeof absent, absent + 1, absent === undefined, table[absent]]);

/** @type {number} */
const truth = true;
attempt("a number that is true", () => [typeof truth, truth + 1, truth === 1, truth == 1, table[truth]]);

/** @type {number} */
const big = 3n;
attempt("a number that is a bigint", () => [typeof big, big * 2n, big == 3]);
attempt("a number that is a bigint, mixed", () => big + 1);

/** @type {number} */
const object = { valueOf: () => 3 };
attempt("a number that is an object", () => [typeof object, object + 1, object * 2, table[object], object === 3]);

/** @type {number} */
const list = [3];
attempt("a number that is a list", () => [typeof list, list + 1, list * 2, table[list], list.length]);

/** @type {string} */
const count = 12;
attempt("a text that is a number", () => [typeof count, count + 1, count + "!", count.length, count[0], count === "12"]);
attempt("a text that is a number, a method", () => count.toUpperCase());

/** @type {string} */
const letters = ["a", "b"];
attempt("a text that is a list", () => [typeof letters, letters + "!", letters.length, letters[0], letters.slice(1), letters.indexOf("b"), letters.includes("a"), letters.concat("c"), letters.at(-1)]);
attempt("a text that is a list, a method only texts have", () => letters.toUpperCase());

/** @type {boolean} */
const zero = 0;
attempt("a truth that is zero", () => [typeof zero, zero === false, zero == false, !zero, zero ? "truthy" : "falsy", zero + 1]);

/** @type {boolean} */
const word = "false";
attempt("a truth that is a text", () => [typeof word, word === false, !word, word ? "truthy" : "falsy", word && 1, word || 2]);

/** @type {bigint} */
const small = 3;
attempt("a bigint that is a number", () => [typeof small, small + 1, small === 3]);
attempt("a bigint that is a number, mixed", () => small + 1n);

/** @type {symbol} */
const label = "label";
attempt("a symbol that is a text", () => [typeof label, label + "!", { [label]: 1 }, label.description]);

/** @type {number} */
let changing = 1;
attempt("a variable that changes its kind", () => {
  const seen = [changing + 1];
  changing = "two";
  seen.push(changing + 1);
  changing = null;
  seen.push(changing + 1);
  changing = { valueOf: () => 4 };
  seen.push(changing + 1);
  changing = 5;
  seen.push(changing + 1);
  return seen;
});

/** @type {number} */
var hoisted = early();
function early() {
  return typeof hoisted + " before";
}
attempt("a variable read before its value", () => [hoisted, hoisted + 1]);

function inALoop() {
  /** @type {number} */
  let total = 0;
  for (let i = 0; i < 2000; i++) total += i;
  total += "!";
  for (let i = 0; i < 3; i++) total += i;
  return total;
}
attempt("a total that becomes a text after 2000 rounds", inALoop);

function captured() {
  /** @type {number} */
  let n = 1;
  const read = () => n + 1;
  const first = read();
  n = "text";
  return [first, read()];
}
attempt("a captured variable", captured);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: attempt captured read
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
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<number> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_3]]
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v2 layout=[[L_3]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5 calleeName="read"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="n"
// CHECK-NEXT: v10 = String string="text"
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v11 layout=[[L_3]]
// CHECK-NEXT: v13 = Call v5 calleeName="read"
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = NewArray v7, v14 contents=number
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_3]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
