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

function trim(text) {
  return text.trim();
}

function trimStart(text) {
  return text.trimStart();
}

function trimEnd(text) {
  return text.trimEnd();
}

function padStart(text) {
  return text.padStart(14, "ab");
}

function padEnd(text) {
  return text.padEnd(14);
}

function repeat(text) {
  return text.repeat(2);
}

function receivers(name) {
  return [
    "'hello world'",
    "''",
    "'hello'.concat(' ', 'world')",
    "'h\\u00e9llo w\\u4e16rld'",
    "'\\ud83d\\ude00 \\ud83d alone'",
    "new String('hello world')",
    "Object.assign(new String('hello world'), { " + name + "() { return 'own member'; } })",
    "Object.setPrototypeOf(new String('hello world'), { " + name + "() { return 'other prototype'; } })",
    "Object.setPrototypeOf(new String('hello world'), null)",
    "{ " + name + "(...given) { return 'mine ' + given.length; } }",
    "{ " + name + ": String.prototype." + name + ", toString() { return 'borrowed method'; } }",
    "{ " + name + ": 5 }",
    "{}",
    "['h', 'e', 'l', 'l', 'o', ' ', 'w']",
    "Buffer.from('hello world')",
    "new Uint8Array([104, 101, 108, 108, 111])",
    "12345",
    "-0",
    "12345n",
    "Symbol('hello')",
    "true",
    "null",
    "undefined",
    "new Proxy(new String('hello world'), {})",
    "new Proxy({}, { get(target, key) { return () => 'trapped ' + String(key); } })",
  ];
}

const uses = [
  ["trim", trim],
  ["trimStart", trimStart],
  ["trimEnd", trimEnd],
  ["padStart", padStart],
  ["padEnd", padEnd],
  ["repeat", repeat],
];

for (const [name, use] of uses) attempt("the first call of all: " + name + " of a String object", () => use(make("new String('  x  ')")));

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += trim("  a ").length + trimStart("  a ").length + trimEnd("  a ").length + padStart("a").length + padEnd("a").length + repeat("ab").length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of receivers(name)) attempt(name + " of " + text, () => use(make(text)));
  attempt(name + " of a string again", () => use(" \t\n ﻿ hello  "));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
