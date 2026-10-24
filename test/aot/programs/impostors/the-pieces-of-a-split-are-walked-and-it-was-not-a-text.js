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

function countFields(text) {
  let count = 0;
  for (const field of text.split(",")) count++;
  return count;
}

function lengthsOfFields(text) {
  const lengths = [];
  for (const field of text.split(",")) lengths.push(field.length);
  return lengths;
}

function secondField(text) {
  return text.split(",")[1];
}

function numberOfFields(text) {
  return text.split(",").length;
}

function upperFields(text) {
  return text.split(",").map(field => field.toUpperCase());
}

function rejoined(text) {
  return text.split(",").join(";");
}

function firstAndRest(text) {
  const [first, ...rest] = text.split(",");
  return [first, rest];
}

function lastField(text) {
  return text.split(",").pop();
}

function fieldsByIndex(text) {
  const fields = text.split(",");
  const seen = [];
  for (let i = 0; i < fields.length; i++) seen.push(fields[i].trim());
  return seen;
}

function splitBy(text, separator) {
  const seen = [];
  for (const field of text.split(separator)) seen.push(field);
  return seen;
}

function linesAndWords(text) {
  let words = 0;
  for (const line of text.split("\n")) {
    for (const word of line.split(" ")) if (word !== "") words++;
  }
  return words;
}

const log = [];
globalThis.log = log;

const uses = [
  ["count", countFields],
  ["lengths", lengthsOfFields],
  ["second", secondField],
  ["number", numberOfFields],
  ["upper", upperFields],
  ["rejoined", rejoined],
  ["first and rest", firstAndRest],
  ["last", lastField],
  ["by index", fieldsByIndex],
  ["lines and words", linesAndWords],
];

const values = [
  "'a,b,c'",
  "''",
  "','",
  "'a'",
  "'a,\\u4e16,\\ud83d\\ude00'",
  "'a,' + 'b'",
  "new String('a,b')",
  "{ split() { return 'a text, not a list'; } }",
  "{ split() { return [1, null, 'c']; } }",
  "{ split() { return new Set(['x', 'y']); } }",
  "{ split() { return { length: 2, 0: 'x', 1: 'y' }; } }",
  "{ split() { return null; } }",
  "{ split() { log.push('split'); return ['x', 'y']; } }",
  "{ split() { return Object.assign(['x', 'y'], { *[Symbol.iterator]() { yield 'from its own iterator'; }, map() { return 'its own map'; }, join() { return 'its own join'; }, pop() { return 'its own pop'; } }); } }",
  "{ split(separator) { return [typeof separator, separator]; } }",
  "['a,b', 'c']",
  "Buffer.from('a,b')",
  "5",
  "null",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("a,b,c")).length;
  total += splitBy("a-b", "-").length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) attempt(name + " of " + text, () => use(make(text)));
}
console.log("split was called", log.length, "times");

const separators = ["','", "''", "undefined", "null", "1", "/,/", "/(,)/", "/,|(x)/", "[',']", "{ toString() { return ','; } }", "{ [Symbol.split](text, limit) { return ['stand-in', typeof text, limit]; } }", "Symbol(',')", "new String(',')"];
for (const separator of separators) attempt("'a,1,null' split by " + separator, () => splitBy("a,1,null", make(separator)));

console.log("bytes made in plain sight", Buffer.from("he").length);
