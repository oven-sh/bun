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

const log = [];

function noisy(name, result) {
  return {
    valueOf() {
      log.push(name + ".valueOf");
      return result;
    },
    toString() {
      log.push(name + ".toString");
      return String(result);
    },
  };
}

function less(a, b) {
  return a < b;
}

function greater(a, b) {
  return a > b;
}

function lessOrEqual(a, b) {
  return a <= b;
}

function greaterOrEqual(a, b) {
  return a >= b;
}

function compareTexts(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function smallest(values) {
  let best = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < best) best = values[i];
  }
  return best;
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const a = "abc"[i % 3];
  const b = "cab"[i % 3];
  if (less(a, b)) total++;
  if (greater(a, b)) total += 2;
  if (lessOrEqual(a, b)) total += 3;
  if (greaterOrEqual(a, b)) total += 5;
  total += compareTexts(a, b) + smallest([a, b, "b"]).length;
}
console.log("2000 honest rounds", total);

const pairs = [
  ["'10'", "'9'"],
  ["10", "'9'"],
  ["'10'", "9"],
  ["10", "9"],
  ["'a'", "'B'"],
  ["'a'", "1"],
  ["''", "0"],
  ["' '", "0"],
  ["'abc'", "'abcd'"],
  ["'abc'", "'ab' + 'c'"],
  ["'\\uffff'", "'\\ud800\\udc00'"],
  ["'\\u00e9'", "'\\u4e16'"],
  ["'z'", "'\\u00e9'"],
  ["null", "''"],
  ["null", "'0'"],
  ["undefined", "'undefined'"],
  ["'1'", "1n"],
  ["'1.5'", "1n"],
  ["'x'", "1n"],
  ["2n", "'1'"],
  ["true", "'1'"],
  ["[2]", "'10'"],
  ["[2]", "10"],
  ["[1, 2]", "'1,3'"],
  ["new String('a')", "new String('b')"],
  ["new String('10')", "new String('9')"],
  ["new Number(10)", "new String('9')"],
  ["{}", "'[object Object]'"],
  ["{}", "'[object Objecu]'"],
  ["Symbol('a')", "'b'"],
  ["'a'", "Symbol('b')"],
  ["new Date(5)", "'6'"],
  ["-0", "'0'"],
  ["NaN", "'NaN'"],
];

for (const [a, b] of pairs) {
  attempt(a + " against " + b, () => {
    const left = make(a);
    const right = make(b);
    return [less(left, right), greater(left, right), lessOrEqual(left, right), greaterOrEqual(left, right), compareTexts(left, right)].join(" ");
  });
}

function report(label, run) {
  attempt(label, run);
  console.log("  order:", log.splice(0).join(" "));
}

report("a < b converts a first", () => less(noisy("a", "x"), noisy("b", "y")));
report("a > b converts a first", () => greater(noisy("a", "x"), noisy("b", "y")));
report("a <= b converts a first", () => lessOrEqual(noisy("a", "x"), noisy("b", "y")));
report("a >= b converts a first", () => greaterOrEqual(noisy("a", "x"), noisy("b", "y")));
report("a text and a number from objects", () => less(noisy("a", "10"), noisy("b", 9)));
report("two texts from objects", () => less(noisy("a", "10"), noisy("b", "9")));
report("the left one throws", () => less({ valueOf() { log.push("a throws"); throw new RangeError("no"); } }, noisy("b", 1)));
report("the right one is a symbol", () => less(noisy("a", 1), Symbol("s")));
report("three way", () => compareTexts(noisy("a", "x"), noisy("b", "x")));
report("smallest of mixed values", () => [smallest(["10", "9", "8"]), smallest([10, "9", 8]), smallest(["b", undefined, "a"]), smallest(["b", null, "a"]), smallest([noisy("a", 3), noisy("b", "2")]) === undefined]);
