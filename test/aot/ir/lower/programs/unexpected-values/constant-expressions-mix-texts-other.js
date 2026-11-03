// RUN: lower
// OPTIONS: builtin-modules

// Constant expressions mix texts and other values.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const rows = [
  ['"5" * "2"', "5" * "2", (a, b) => a * b, "5", "2"],
  ['"5" + 2', "5" + 2, (a, b) => a + b, "5", 2],
  ['5 + "2"', 5 + "2", (a, b) => a + b, 5, "2"],
  ['"5" - 2', "5" - 2, (a, b) => a - b, "5", 2],
  ['"5" / "0"', "5" / "0", (a, b) => a / b, "5", "0"],
  ['"-5" % 5', "-5" % 5, (a, b) => a % b, "-5", 5],
  ['"a" * 1', "a" * 1, (a, b) => a * b, "a", 1],
  ['"" * 1', "" * 1, (a, b) => a * b, "", 1],
  ['" " - 0', " " - 0, (a, b) => a - b, " ", 0],
  ['"0x10" | 0', "0x10" | 0, (a, b) => a | b, "0x10", 0],
  ['"4294967297" | 0', "4294967297" | 0, (a, b) => a | b, "4294967297", 0],
  ['"-1" >>> 0', "-1" >>> 0, (a, b) => a >>> b, "-1", 0],
  ['"1" << "33"', "1" << "33", (a, b) => a << b, "1", "33"],
  ['"2" ** "10"', "2" ** "10", (a, b) => a ** b, "2", "10"],
  ['null + "x"', null + "x", (a, b) => a + b, null, "x"],
  ['undefined + "x"', undefined + "x", (a, b) => a + b, undefined, "x"],
  ['true + "x"', true + "x", (a, b) => a + b, true, "x"],
  ['-0 + ""', -0 + "", (a, b) => a + b, -0, ""],
  ['1e21 + ""', 1e21 + "", (a, b) => a + b, 1e21, ""],
  ['1e-7 + ""', 1e-7 + "", (a, b) => a + b, 1e-7, ""],
  ['0.1 + 0.2 + ""', 0.1 + 0.2 + "", (a, b) => a + 0.2 + b, 0.1, ""],
  ['"" + 0.1 + 0.2', "" + 0.1 + 0.2, (a, b) => a + b + 0.2, "", 0.1],
  ['1n + "x"', 1n + "x", (a, b) => a + b, 1n, "x"],
  ['"10" < "9"', "10" < "9", (a, b) => a < b, "10", "9"],
  ['"10" < 9', "10" < 9, (a, b) => a < b, "10", 9],
  ['10 < "9"', 10 < "9", (a, b) => a < b, 10, "9"],
  ['"a" < 1', "a" < 1, (a, b) => a < b, "a", 1],
  ['"a" >= 1', "a" >= 1, (a, b) => a >= b, "a", 1],
  ['"" < 1', "" < 1, (a, b) => a < b, "", 1],
  ['null < "1"', null < "1", (a, b) => a < b, null, "1"],
  ['undefined < "1"', undefined < "1", (a, b) => a < b, undefined, "1"],
  ['"2" > 1n', "2" > 1n, (a, b) => a > b, "2", 1n],
  ['"x" > 1n', "x" > 1n, (a, b) => a > b, "x", 1n],
  ['"B" < "a"', "B" < "a", (a, b) => a < b, "B", "a"],
  ['"\\uffff" < "\\ud800\\udc00"', "￿" < "𐀀", (a, b) => a < b, "￿", "𐀀"],
  ['"1" == 1', "1" == 1, (a, b) => a == b, "1", 1],
  ['"1.0" == 1', "1.0" == 1, (a, b) => a == b, "1.0", 1],
  ['"" == 0', "" == 0, (a, b) => a == b, "", 0],
  ['" \\n" == 0', " \n" == 0, (a, b) => a == b, " \n", 0],
  ['"0" == false', "0" == false, (a, b) => a == b, "0", false],
  ['"" == false', "" == false, (a, b) => a == b, "", false],
  ['"false" == false', "false" == false, (a, b) => a == b, "false", false],
  ['"null" == null', "null" == null, (a, b) => a == b, "null", null],
  ['"" == null', "" == null, (a, b) => a == b, "", null],
  ['"1" == 1n', "1" == 1n, (a, b) => a == b, "1", 1n],
  ['"1.5" == 1n', "1.5" == 1n, (a, b) => a == b, "1.5", 1n],
  ['"NaN" == NaN', "NaN" == NaN, (a, b) => a == b, "NaN", NaN],
  ['"1" === 1', "1" === 1, (a, b) => a === b, "1", 1],
  ['"a" === "a"', "a" === "a", (a, b) => a === b, "a", "a"],
  ['"a" && 0', "a" && 0, (a, b) => a && b, "a", 0],
  ['"" && 1', "" && 1, (a, b) => a && b, "", 1],
  ['"" || "x"', "" || "x", (a, b) => a || b, "", "x"],
  ['"" ?? "x"', "" ?? "x", (a, b) => a ?? b, "", "x"],
  ['"0" || "x"', "0" || "x", (a, b) => a || b, "0", "x"],
  ['"abc"[1]', "abc"[1], (a, b) => a[b], "abc", 1],
  ['"abc"["1"]', "abc"["1"], (a, b) => a[b], "abc", "1"],
  ['"abc"[3]', "abc"[3], (a, b) => a[b], "abc", 3],
  ['"abc"[-1]', "abc"[-1], (a, b) => a[b], "abc", -1],
  ['"abc"[1.5]', "abc"[1.5], (a, b) => a[b], "abc", 1.5],
  ['"abc"["length"]', "abc"["length"], (a, b) => a[b], "abc", "length"],
  ['"abc".charCodeAt(5)', "abc".charCodeAt(5), (a, b) => a.charCodeAt(b), "abc", 5],
  ['"abc".charCodeAt("1")', "abc".charCodeAt("1"), (a, b) => a.charCodeAt(b), "abc", "1"],
  ['"abc".charAt(-1)', "abc".charAt(-1), (a, b) => a.charAt(b), "abc", -1],
  ['"abc".at(-1)', "abc".at(-1), (a, b) => a.at(b), "abc", -1],
  ['"abc".slice(-2)', "abc".slice(-2), (a, b) => a.slice(b), "abc", -2],
  ['"abc".substring(2, 0)', "abc".substring(2, 0), (a, b) => a.substring(b, 0), "abc", 2],
  ['"abc".indexOf("")', "abc".indexOf(""), (a, b) => a.indexOf(b), "abc", ""],
  ['"abc".lastIndexOf("")', "abc".lastIndexOf(""), (a, b) => a.lastIndexOf(b), "abc", ""],
  ['"a1b".indexOf(1)', "a1b".indexOf(1), (a, b) => a.indexOf(b), "a1b", 1],
  ['"anull".includes(null)', "anull".includes(null), (a, b) => a.includes(b), "anull", null],
  ['"x".repeat(0)', "x".repeat(0), (a, b) => a.repeat(b), "x", 0],
  ['"x".repeat("2")', "x".repeat("2"), (a, b) => a.repeat(b), "x", "2"],
  ['"x".padStart(3, "")', "x".padStart(3, ""), (a, b) => a.padStart(3, b), "x", ""],
  ['"x".padStart(3, 12)', "x".padStart(3, 12), (a, b) => a.padStart(3, b), "x", 12],
  ['"\\u00df".toUpperCase()', "ß".toUpperCase(), a => a.toUpperCase(), "ß", 0],
  ['"\\u0130".toLowerCase().length', "İ".toLowerCase().length, a => a.toLowerCase().length, "İ", 0],
  ['"\\ud83d\\ude00".length', "😀".length, a => a.length, "😀", 0],
  ['"\\ud83d\\ude00".codePointAt(1)', "😀".codePointAt(1), (a, b) => a.codePointAt(b), "😀", 1],
  ['"a-b".replace("-", "$&$&")', "a-b".replace("-", "$&$&"), (a, b) => a.replace("-", b), "a-b", "$&$&"],
  ['"a,b".split(",").length', "a,b".split(",").length, (a, b) => a.split(b).length, "a,b", ","],
  ['"".split("").length', "".split("").length, (a, b) => a.split(b).length, "", ""],
  ['"".split(",").length', "".split(",").length, (a, b) => a.split(b).length, "", ","],
  ['"a".concat(1, null)', "a".concat(1, null), (a, b) => a.concat(b, null), "a", 1],
  ['"a".localeCompare("b")', "a".localeCompare("b"), (a, b) => a.localeCompare(b), "a", "b"],
  ['typeof ("a" + 1)', typeof ("a" + 1), (a, b) => typeof (a + b), "a", 1],
  ['typeof ("2" * 1)', typeof ("2" * 1), (a, b) => typeof (a * b), "2", 1],
  ['+"-0"', +"-0", a => +a, "-0", 0],
  ['-"0"', -"0", a => -a, "0", 0],
  ['~"5"', ~"5", a => ~a, "5", 0],
  ['!"0"', !"0", a => !a, "0", 0],
  ['!""', !"", a => !a, "", 0],
  ['`${-0}`', `${-0}`, a => `${a}`, -0, 0],
  ['`${null}${undefined}`', `${null}${undefined}`, (a, b) => `${a}${b}`, null, undefined],
  ['`${[1, [2]]}`', `${[1, [2]]}`, a => `${a}`, [1, [2]], 0],
  ['String(-0)', String(-0), a => String(a), -0, 0],
  ['"length" in Object("a")', "length" in Object("a"), (a, b) => a in Object(b), "length", "a"],
];

function hidden(value) {
  return hiddenValues[hiddenValues.push(value) - 1];
}
const hiddenValues = [];

let different = 0;
for (const [label, folded, compute, a, b] of rows) {
  const computed = compute(hidden(a), hidden(b));
  const same = Object.is(folded, computed);
  if (!same) different++;
  console.log((same ? "" : "WRONG ") + label + " -> " + show(folded) + (same ? "" : " but at run time " + show(computed)));
}
console.log("different:", different);

// GENERATED: attempt hidden
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string|bigint|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]]|[[f_8]]|Array<undefined|null|number|Array<number>> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|boolean|number|string|bigint|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]]|[[f_8]]|Array<undefined|null|number|Array<number>>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="hiddenValues"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="hiddenValues"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v0 calleeKey="push" calleeName="hiddenValues.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Sub v8, v9
// CHECK-NEXT: v11 = ElemGet v2, v10
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
