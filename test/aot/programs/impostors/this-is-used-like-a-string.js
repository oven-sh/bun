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

function firstCode() {
  return this.charCodeAt(0);
}

function lengthOfThis() {
  return this.length;
}

function describeThis() {
  return typeof this + " " + (this === undefined || this === null ? "" : Object.prototype.toString.call(this));
}

function thisPlusText() {
  return this + "!";
}

function thisIsHello() {
  return this === "hello";
}

function firstOfThis() {
  return this[0];
}

function charactersOfThis() {
  return [...this];
}

const uses = [
  ["first code", firstCode],
  ["length", lengthOfThis],
  ["describe", describeThis],
  ["plus text", thisPlusText],
  ["is hello", thisIsHello],
  ["first", firstOfThis],
  ["characters", charactersOfThis],
];

const values = [
  "'hello'",
  "''",
  "new String('hello')",
  "['h', 'e']",
  "{ length: 1, 0: 'x', charCodeAt() { return 'look alike'; }, toString() { return 'alike'; }, *[Symbol.iterator]() { yield 'y'; } }",
  "5",
  "null",
  "undefined",
  "Symbol('s')",
  "true",
  "Buffer.from('he')",
];

console.log("bytes made in plain sight", Buffer.from("he").length);

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use.call("hello")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " by call " + text, () => use.call(make(text)));
    attempt(name + " by apply " + text, () => use.apply(make(text), []));
    attempt(name + " by bind " + text, () => use.bind(make(text))());
  }
  attempt(name + " with no this", () => use());
  attempt(name + " as a member of an object", () => ({ use, length: 2, 0: "m", charCodeAt: () => "member", toString: () => "member", [Symbol.iterator]: () => [][Symbol.iterator]() }).use());
  attempt(name + " by Reflect.apply", () => Reflect.apply(use, "hello", []));
}
