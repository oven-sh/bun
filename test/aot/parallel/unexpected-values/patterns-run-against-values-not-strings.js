// Patterns are run against values that are not strings.
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
globalThis.log = log;

function isWord(value) {
  return /^\w+$/.test(value);
}

function hasDigit(value) {
  return /\d/.test(value);
}

function firstNumber(value) {
  const found = /(\d+)/.exec(value);
  return found === null ? null : [found[0], found[1], found.index, typeof found.input, found.input.length];
}

function mentionsNothing(value) {
  return /null|undefined|NaN|object/.test(value);
}

function countMatches(value) {
  const pattern = /l/g;
  let count = 0;
  while (pattern.exec(value) !== null && count < 10) count++;
  return count;
}

function stickyAtOne(value) {
  const pattern = /e/y;
  pattern.lastIndex = 1;
  return [pattern.test(value), pattern.lastIndex];
}

function named(value) {
  const found = /(?<head>\w)(?<tail>\w*)/.exec(value);
  return found && [found.groups.head, found.groups.tail];
}

const uses = [
  ["is a word", isWord],
  ["has a digit", hasDigit],
  ["first number", firstNumber],
  ["mentions nothing", mentionsNothing],
  ["count of l", countMatches],
  ["sticky at one", stickyAtOne],
  ["named groups", named],
];

const values = [
  "'hello1'",
  "''",
  "'he' + 'llo'",
  "'h\\u00e9llo \\u4e16 42'",
  "new String('hello1')",
  "Object.assign(new String('hello1'), { toString() { log.push('toString'); return 'changed 7'; } })",
  "12345",
  "-0",
  "1e21",
  "NaN",
  "12n",
  "true",
  "null",
  "undefined",
  "[]",
  "['hello', 1]",
  "{}",
  "{ toString() { log.push('toString'); return 'hello 5'; }, valueOf() { log.push('valueOf'); return 'no'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'hello 6'; } }",
  "Symbol('hello1')",
  "Buffer.from('hello1')",
  "new Uint8Array([1, 2])",
  "/hello1/",
  "new Date(NaN)",
  "Object.create(null)",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("hello1")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " " + text, () => use(make(text)));
    if (log.length) console.log("  log:", log.splice(0).join(", "));
  }
}
attempt("no argument at all", () => [/undefined/.test(), /^undefined$/.exec()[0]]);

for (const position of ["1", "'1'", "1.9", "-1", "NaN", "null", "undefined", "99", "2 ** 32 + 1", "{ valueOf() { log.push('valueOf'); return 1; } }", "1n", "Symbol('1')"]) {
  attempt("lastIndex is " + position, () => {
    const pattern = /l/g;
    pattern.lastIndex = make(position);
    const found = pattern.exec("hello");
    return [found && found.index, pattern.lastIndex];
  });
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
