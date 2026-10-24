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

function lengthOfTexts(value) {
  if (typeof value === "string") return value.length;
  return "not a text";
}

function upperOrSame(value) {
  return typeof value === "string" ? value.toUpperCase() : value;
}

function notAText(value) {
  if (typeof value !== "string") return "not a text: " + typeof value;
  return value.charCodeAt(0);
}

function textOrList(value) {
  if (typeof value === "string") return value.split(",");
  return value.slice();
}

function textOrNumber(value) {
  if (typeof value === "string") return value + "!";
  if (typeof value === "number") return value + 1;
  return null;
}

function looseTypeof(value) {
  return typeof value == "string" && value.length > 0;
}

function literalFirst(value) {
  return "string" === typeof value ? value.trim() : "no";
}

function byInstanceof(value) {
  return value instanceof String ? "wrapped " + value.length : "not wrapped";
}

function byConstructor(value) {
  return value != null && value.constructor === String ? "made by String: " + value.length : "made by something else";
}

function byTag(value) {
  return Object.prototype.toString.call(value) === "[object String]" ? "tagged String: " + value.length : "tagged otherwise";
}

function eitherKind(value) {
  return typeof value === "string" || value instanceof String ? value.length : -1;
}

const uses = [
  ["length of texts", lengthOfTexts],
  ["upper or same", upperOrSame],
  ["not a text", notAText],
  ["text or list", textOrList],
  ["text or number", textOrNumber],
  ["loose typeof", looseTypeof],
  ["literal first", literalFirst],
  ["instanceof", byInstanceof],
  ["constructor", byConstructor],
  ["tag", byTag],
  ["either kind", eitherKind],
];

const values = [
  "'a,b'",
  "''",
  "'a' + ',b'",
  "new String('a,b')",
  "Object.setPrototypeOf(new String('a,b'), null)",
  "Object.setPrototypeOf(new String('a,b'), Array.prototype)",
  "Object.create(String.prototype)",
  "Object.setPrototypeOf(['a', 'b'], String.prototype)",
  "{ constructor: String, length: 'a lie' }",
  "{ [Symbol.toStringTag]: 'String', length: 'a lie' }",
  "Object.assign(new String('a,b'), { [Symbol.toStringTag]: 'Other' })",
  "{ __proto__: { [Symbol.hasInstance]: 1 }, length: 3 }",
  "['a', 'b']",
  "5",
  "5n",
  "null",
  "undefined",
  "true",
  "Symbol('a')",
  "function f() {}",
  "Buffer.from('a,b')",
  "new Proxy(new String('a,b'), {})",
  "String",
  "String.prototype",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("a,b")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " of " + text, () => {
      const given = make(text);
      const result = use(given);
      return result === given && typeof given === "object" && given !== null ? "the same object" : typeof result === "function" ? "function " + result.name : result;
    });
  }
}

console.log("bytes made in plain sight", Buffer.from("he").length);
