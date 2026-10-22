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

const made = {
  "'text'": () => ('text'),
  "''": () => (''),
  "'' + ''": () => ('' + ''),
  "'x'.slice(1)": () => ('x'.slice(1)),
  "[].join()": () => ([].join()),
  "String()": () => (String()),
  "' '": () => (' '),
  "'0'": () => ('0'),
  "'false'": () => ('false'),
  "'null'": () => ('null'),
  "'\\0'": () => ('\0'),
  "new String('')": () => (new String('')),
  "new String('text')": () => (new String('text')),
  "0": () => (0),
  "-0": () => (-0),
  "NaN": () => (NaN),
  "0n": () => (0n),
  "1n": () => (1n),
  "false": () => (false),
  "new Boolean(false)": () => (new Boolean(false)),
  "new Number(0)": () => (new Number(0)),
  "null": () => (null),
  "undefined": () => (undefined),
  "[]": () => ([]),
  "['']": () => (['']),
  "[0]": () => ([0]),
  "{}": () => ({}),
  "{ length: 0, slice() { return ''; } }": () => ({ length: 0, slice() { return ''; } }),
  "{ valueOf() { return ''; }, toString() { return ''; } }": () => ({ valueOf() { return ''; }, toString() { return ''; } }),
  "Buffer.alloc(0)": () => (Buffer.alloc(0)),
  "Symbol()": () => (Symbol()),
};

function make(text) {
  return made[text]();
}

function isTrue(value) {
  return value ? "yes" : "no";
}

function isFalse(value) {
  return !value;
}

function orDefault(value) {
  return value || "default";
}

function nullishDefault(value) {
  return value ?? "default";
}

function andLength(value) {
  return value && value.length;
}

function lengthIfAny(value) {
  return value?.length;
}

function ifStatement(value) {
  if (value) return "taken";
  return "skipped";
}

function whileLoop(value) {
  let rounds = 0;
  while (value) {
    rounds++;
    value = value.slice(1);
    if (rounds > 5) break;
  }
  return rounds;
}

function doubleNot(value) {
  return !!value;
}

function byBoolean(value) {
  return Boolean(value);
}

function filtered(values) {
  return values.filter(Boolean).length;
}

function defaultParameter(value = "default") {
  return value;
}

function defaultInAPattern({ value = "default" }) {
  return value;
}

function isEmptyByComparison(value) {
  return [value === "", value == "", value == false, value == 0, value == null];
}

const uses = [
  ["? :", isTrue],
  ["!", isFalse],
  ["||", orDefault],
  ["??", nullishDefault],
  ["&& length", andLength],
  ["?.length", lengthIfAny],
  ["if", ifStatement],
  ["while", whileLoop],
  ["!!", doubleNot],
  ["Boolean", byBoolean],
  ["filter", value => filtered([value, value])],
  ["default parameter", defaultParameter],
  ["default in a pattern", value => defaultInAPattern({ value })],
  ["comparisons", isEmptyByComparison],
];

const values = [
  "'text'",
  "''",
  "'' + ''",
  "'x'.slice(1)",
  "[].join()",
  "String()",
  "' '",
  "'0'",
  "'false'",
  "'null'",
  "'\\0'",
  "new String('')",
  "new String('text')",
  "0",
  "-0",
  "NaN",
  "0n",
  "1n",
  "false",
  "new Boolean(false)",
  "new Number(0)",
  "null",
  "undefined",
  "[]",
  "['']",
  "[0]",
  "{}",
  "{ length: 0, slice() { return ''; } }",
  "{ valueOf() { return ''; }, toString() { return ''; } }",
  "Buffer.alloc(0)",
  "Symbol()",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(i % 2 ? "text" : "")).length;
}
console.log("2000 honest rounds", total);

function outcome(use, text) {
  try {
    const given = make(text);
    const result = use(given);
    return result === given && typeof given === "object" && given !== null ? "the same object" : show(result);
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const text of values) {
  for (let from = 0; from < uses.length; from += 5) {
    console.log(text + " -> " + uses.slice(from, from + 5).map(([name, use]) => name + " " + outcome(use, text)).join("; "));
  }
}
