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

function codeAt(text, index) {
  return text.charCodeAt(index);
}

function characterAt(text, index) {
  return text.charAt(index);
}

function codePointAt(text, index) {
  return text.codePointAt(index);
}

function at(text, index) {
  return text.at(index);
}

function element(text, index) {
  return text[index];
}

const log = [];
globalThis.log = log;

const positions = [
  "0",
  "4",
  "5",
  "-1",
  "-5",
  "-6",
  "-0",
  "1.5",
  "-0.5",
  "0.9999999",
  "NaN",
  "Infinity",
  "-Infinity",
  "2147483647",
  "2147483648",
  "-2147483648",
  "4294967296",
  "4294967297",
  "9007199254740993",
  "'1'",
  "'01'",
  "' 1 '",
  "'1e0'",
  "'0x1'",
  "''",
  "'length'",
  "'x'",
  "null",
  "undefined",
  "true",
  "false",
  "[]",
  "[2]",
  "[1, 2]",
  "{}",
  "{ valueOf() { log.push('valueOf'); return 2; } }",
  "{ toString() { log.push('toString'); return '3'; } }",
  "{ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '1'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 1; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }",
  "new Number(3)",
  "new String('2')",
  "1n",
  "Symbol('1')",
  "Symbol.iterator",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += codeAt("hello", i % 5) + characterAt("hello", i % 5).length + codePointAt("hello", i % 5) + at("hello", i % 5).length + element("hello", i % 5).length;
}
console.log("2000 honest rounds", total);

for (const position of positions) {
  attempt("charCodeAt(" + position + ")", () => codeAt("hello", make(position)));
  attempt("charAt(" + position + ")", () => characterAt("hello", make(position)));
  attempt("codePointAt(" + position + ")", () => codePointAt("hello", make(position)));
  attempt("at(" + position + ")", () => at("hello", make(position)));
  attempt("[" + position + "]", () => element("hello", make(position)));
  if (log.length) console.log("conversions", log.splice(0).join(" "));
}
attempt("no position at all", () => ["hello".charCodeAt(), "hello".charAt(), "hello".codePointAt(), "hello".at()]);
attempt("honest again", () => [codeAt("hello", 1), characterAt("hello", 1), codePointAt("hello", 1), at("hello", 1), element("hello", 1)]);
