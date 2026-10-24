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

function fromCode(code) {
  return String.fromCharCode(code);
}

function fromCodePoint(code) {
  return String.fromCodePoint(code);
}

function fromTwoCodes(first, second) {
  return String.fromCharCode(first, second);
}

function fromManyCodes(codes) {
  return String.fromCharCode(...codes);
}

function fromCodesByApply(codes) {
  return String.fromCharCode.apply(null, codes);
}

function shiftLetter(text) {
  return String.fromCharCode(text.charCodeAt(0) + 1);
}

function raw(strings, ...values) {
  return String.raw(strings, ...values);
}

for (let i = 0; i < 2000; i++) {
  fromCode(97 + (i % 26));
  fromCodePoint(97);
  fromTwoCodes(97, 98);
  fromManyCodes([97, 98]);
  fromCodesByApply([97, 98]);
  shiftLetter("a");
}

const codes = ["97", "'97'", "97.9", "-1", "65536 + 97", "0x1f600", "0x110000", "-0", "NaN", "Infinity", "null", "undefined", "true", "''", "'a'", "[97]", "[]", "[97, 98]", "{}", "{ valueOf() { log.push('valueOf'); return 97; } }", "new Number(97)", "97n", "Symbol('97')", "0xd83d", "2 ** 32 + 97", "1e21"];
for (const code of codes) {
  attempt("fromCharCode(" + code + ")", () => fromCode(make(code)));
  attempt("fromCodePoint(" + code + ")", () => fromCodePoint(make(code)));
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}
attempt("no code at all", () => [String.fromCharCode(), String.fromCodePoint()]);
attempt("two halves", () => [fromTwoCodes(0xd83d, 0xde00), fromTwoCodes(0xd83d, 0xde00).length, [...fromTwoCodes(0xd83d, 0xde00)].length]);
attempt("the second code throws after the first is converted", () => fromTwoCodes({ valueOf() { log.push("first"); return 97; } }, Symbol("s")));
console.log("  log:", log.splice(0).join(", "));

for (const list of ["[97, 98]", "'ab'", "'12'", "new Uint8Array([97, 98])", "Buffer.from('ab')", "new Set([97])", "{ length: 2, 0: 97, 1: 98 }", "[]", "[, 97]", "null", "5", "['97', [98]]"]) {
  attempt("spread " + list, () => fromManyCodes(make(list)));
  attempt("apply " + list, () => fromCodesByApply(make(list)));
}

for (const text of ["'a'", "''", "'z'", "'\\uffff'", "new String('a')", "['a']", "{ charCodeAt() { return '9'; } }", "{ charCodeAt() { return 97n; } }", "{ charCodeAt() { return null; } }", "5", "null"]) {
  attempt("shift " + text, () => shiftLetter(make(text)));
}

attempt("String.raw as a tag", () => String.raw`a\n${1}b${null}c${[1, 2]}`);
attempt("String.raw with a plain object", () => raw({ raw: ["a", "b", "c"] }, 1, 2, 3));
attempt("String.raw with a text for the pieces", () => raw({ raw: "abc" }, 1, 2));
attempt("String.raw with an array-like", () => raw({ raw: { length: 2, 0: "x", 1: "y" } }, "-"));
attempt("String.raw with pieces that are not texts", () => raw({ raw: [1, null, undefined, {}] }, "-", "-", "-"));
attempt("String.raw with a symbol among the values", () => raw({ raw: ["a", "b"] }, Symbol("s")));
attempt("String.raw with a symbol that is never reached", () => raw({ raw: ["a"] }, Symbol("s")));
attempt("String.raw with no pieces", () => [raw({ raw: [] }, 1), raw({ raw: { length: -1 } }), raw({ raw: {} })]);
attempt("String.raw with nothing", () => raw({}));
attempt("String.raw with a text", () => raw("abc"));
attempt("borrowed conversions", () => [String.prototype.toString.call("a"), String.prototype.valueOf.call(new String("a"))]);
attempt("String.prototype.toString on a number", () => String.prototype.toString.call(5));
attempt("String.prototype.valueOf on a look-alike", () => String.prototype.valueOf.call({ toString: () => "a" }));
attempt("Number.prototype.toString on a text", () => Number.prototype.toString.call("5"));
attempt("Symbol.prototype.toString on a text", () => Symbol.prototype.toString.call("s"));
attempt("Object.prototype.toString on everything", () => ["a", new String("a"), 5, null, undefined, [], Symbol("s"), 5n, () => {}, /a/, new Date(0), { [Symbol.toStringTag]: "String" }, Object.assign(new String("a"), { [Symbol.toStringTag]: 5 })].map(value => Object.prototype.toString.call(value)));

console.log("bytes made in plain sight", Buffer.from("he").length);
