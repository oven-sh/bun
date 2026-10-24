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

function codesInALoop(text, count) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    try {
      codes.push(text.charCodeAt(i));
    } catch (error) {
      codes.push(error.constructor.name);
    }
  }
  return codes;
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
  ["charCodeAt", value => codeAt(value, 1)],
  ["charAt", value => characterAt(value, 1)],
  ["codePointAt", value => codePointAt(value, 0)],
  ["at", value => at(value, -1)],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += codeAt("hello world", i % 11) + characterAt("hello world", i % 11).length + codePointAt("hello world", i % 11) + at("hello world", i % 11).length;
  total += codesInALoop("hello", 2).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of receivers(name)) attempt(name + " of " + text, () => use(make(text)));
  attempt(name + " of a string again", () => use("hello world"));
}
for (const text of receivers("charCodeAt")) attempt("three codes of " + text, () => codesInALoop(make(text), 3));
attempt("three codes of a string again", () => codesInALoop("hello world", 3));

console.log("bytes made in plain sight", Buffer.from("he").length);
