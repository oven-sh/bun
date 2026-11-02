// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// Unchecked lists maps and tuples are false.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
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

/** @param {number[]} list */
function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

/** @param {number[]} list */
function doubled(list) {
  return list.map(n => n * 2);
}

/** @type {number[]} */
const honest = [1, 2, 3];

/** @type {number[]} */
const texts = ["1", "2"];

/** @type {number[]} */
const mixed = [1, "2", null, undefined, true, [3], { valueOf: () => 4 }];

/** @type {number[]} */
const holes = [1, , 3];

/** @type {number[]} */
const empty = new Array(3);

/** @type {number[]} */
const like = { length: 2, 0: 1, 1: 2 };

/** @type {number[]} */
const typed = new Float64Array([1.5, 2.5]);

/** @type {number[]} */
const set = new Set([1, 2]);

/** @type {number[]} */
const word = "12";

/** @type {Float64Array} */
const plain = [1.5, "2.5"];

/** @type {[number, string]} */
const swapped = ["one", 1];

/** @type {[number, string]} */
const short = [1];

/** @type {[number, string]} */
const long = [1, "one", true, null];

/** @type {Map<string, number>} */
const map = new Map([
  ["a", "1"],
  [2, 2],
]);

/** @type {Map<string, number>} */
const record = { a: 1, get: () => "own get", size: "big" };

/** @type {Set<number>} */
const words = new Set(["a", 1]);

/** @type {Record<string, number>} */
const table = { a: "1", b: null, c: [3] };

/** @type {Record<string, number>} */
const listed = [1, 2];

/** @type {readonly number[]} */
const fixed = [1, 2];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(honest) + doubled(honest)[2] + total([i]);
console.log("2000 honest rounds: " + warm);

for (const [name, list] of Object.entries({ honest, texts, mixed, holes, empty, like, typed, set, word })) {
  attempt(name + ", summed by index", () => [total(list), typeof total(list)]);
  attempt(name + ", summed by iteration", () => {
    let sum = 0;
    for (const n of list) sum += n;
    return sum;
  });
  attempt(name + ", mapped", () => doubled(list));
  attempt(name + ", read", () => [list.length, list[0], list[1] + 1, 1 in list, Array.isArray(list)]);
  attempt(name + ", pushed to", () => [list.push(9), list.length]);
}

attempt("a typed array that is a list", () => [plain[0] + plain[1], plain.length, plain.byteLength, plain.map(n => n + 1)]);
attempt("tuples", () => [swapped[0] + 1, swapped[1] + "!", short[1], short[1] + "!", long.length, long[2]]);
attempt("a tuple, the length of a text that is a number", () => swapped[1].length);
attempt("a tuple, the length of a text that is not there", () => short[1].length);
attempt("a tuple, taken apart", () => {
  const [n, s] = swapped;
  const [m, t = "default"] = short;
  return [n + 1, s + 1, m + 1, t];
});
attempt("a map", () => [map.get("a") + 1, map.get(2) + 1, map.get("2"), map.size, [...map.values()].map(n => n + 1)]);
attempt("a map that is a literal", () => [record.get("a"), record.size, record.a]);
attempt("a map that is a literal, a method it lacks", () => record.has("a"));
attempt("a set", () => [words.has("a"), words.has(1), [...words].map(n => n + 1)]);
attempt("a record", () => [table.a + 1, table.b + 1, table.c + 1, table.d + 1, Object.values(table).map(n => n + 1)]);
attempt("a record that is a list", () => [listed[0] + 1, listed.length, Object.keys(listed).join()]);
attempt("a list declared read-only is changed", () => {
  fixed.push(3);
  fixed[0] = "first";
  fixed.length = 2;
  return [fixed, total(fixed)];
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: doubled attempt valueOf
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=undefined|null|Array<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="map"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="map" calleeName="list.map"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|Array<number> flags=[IsExpected]}}]
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
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
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
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=4
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
