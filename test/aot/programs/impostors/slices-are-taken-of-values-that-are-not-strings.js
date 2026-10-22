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

function slice(text, from, to) {
  return text.slice(from, to);
}

function substring(text, from, to) {
  return text.substring(from, to);
}

function substr(text, from, count) {
  return text.substr(from, count);
}

function tail(text) {
  return text.slice(1);
}

function everySuffix(text) {
  const suffixes = [];
  let rest = text;
  for (let i = 0; i < 4; i++) {
    rest = rest.slice(1);
    suffixes.push(rest);
  }
  return suffixes;
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
  ["slice", value => slice(value, 1, 4)],
  ["substring", value => substring(value, 4, 1)],
  ["substr", value => substr(value, -4, 2)],
];

for (const text of receivers("slice")) attempt("the first call of all: tail of " + text, () => tail(make(text)));

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += slice("hello world", i % 11, 9).length + substring("hello world", i % 11, 3).length + substr("hello world", i % 11, 2).length + tail("hello").length;
  total += everySuffix("hello world").length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of receivers(name)) attempt(name + " of " + text, () => use(make(text)));
  attempt(name + " of a string again", () => use("hello world"));
}
for (const text of receivers("slice")) attempt("suffixes of " + text, () => everySuffix(make(text)));

attempt("a slice of an array is a new array", () => {
  const list = ["a", "b", "c"];
  const copy = slice(list, 0, 3);
  copy.push("d");
  return [list, copy, copy === list];
});
attempt("a slice of a Buffer shares its memory", () => {
  const bytes = Buffer.from("hello");
  const part = slice(bytes, 1, 3);
  part[0] = 69;
  return [bytes.toString(), part.toString()];
});
attempt("a slice of a Uint8Array does not", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const part = slice(bytes, 1, 3);
  part[0] = 9;
  return [bytes, part];
});
