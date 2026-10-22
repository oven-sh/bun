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

function lengthOf(value) {
  return value.length;
}

function first(value) {
  return value[0];
}

function head(value) {
  return value.slice(0, 2);
}

function positionOfL(value) {
  return value.indexOf("l");
}

function lastPositionOfL(value) {
  return value.lastIndexOf("l");
}

function hasEll(value) {
  return value.includes("ell");
}

function last(value) {
  return value.at(-1);
}

function asText(value) {
  return value.toString();
}

function label(value) {
  return "<" + value + ">";
}

function template(value) {
  return `<${value}>`;
}

function isHello(value) {
  return [value === "hello", value == "hello", value < "i", value > "a"];
}

function characters(value) {
  return [...value];
}

function joinedWith(value) {
  return value.concat("!");
}

function upper(value) {
  return value.toUpperCase();
}

function asKey(value) {
  return { hello: "by the text", "104,101,108,108,111": "by the numbers" }[value];
}

function asJson(value) {
  return JSON.stringify(value);
}

function keys(value) {
  return Object.keys(value).length;
}

function equalsItsCopy(value) {
  return value.slice() === value;
}

const uses = [
  ["length", lengthOf],
  ["first", first],
  ["head", head],
  ["indexOf", positionOfL],
  ["lastIndexOf", lastPositionOfL],
  ["includes", hasEll],
  ["at", last],
  ["toString", asText],
  ["label", label],
  ["template", template],
  ["comparisons", isHello],
  ["characters", characters],
  ["concat", joinedWith],
  ["toUpperCase", upper],
  ["as a key", asKey],
  ["JSON", asJson],
  ["keys", keys],
  ["equals its copy", equalsItsCopy],
];

const values = [
  "'hello'",
  "Buffer.from('hello')",
  "new Uint8Array([104, 101, 108, 108, 111])",
  "new Uint8Array(Buffer.from('hello'))",
  "Buffer.from('hello').subarray(1, 4)",
  "Buffer.from('h\\u00e9llo')",
  "Buffer.from('h\\u00e9llo', 'latin1')",
  "Buffer.alloc(0)",
  "new Uint16Array([104, 101, 108, 108, 111])",
  "new Int8Array([-1, 108])",
  "new Float32Array([108, 0.5])",
  "new Uint8ClampedArray([300, -5, 108])",
  "new DataView(new ArrayBuffer(5))",
  "new ArrayBuffer(5)",
  "Buffer.from('hello').buffer.byteLength > 0 ? Buffer.from('hello').toString('base64') : ''",
  "Object.assign(Buffer.from('hello'), { toString() { return 'own toString'; } })",
  "Object.setPrototypeOf(Buffer.from('hello'), String.prototype)",
  "new (class Text extends Uint8Array { toString() { return 'subclass'; } indexOf() { return 'subclass'; } })([104, 105])",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("hello")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) attempt(name + " of " + text, () => use(make(text)));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
