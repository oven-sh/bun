// Values that are not strings are matched and searched.
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

function match(text) {
  return text.match(/l+/);
}

function matchEvery(text) {
  return text.match(/l/g);
}

function matchText(text) {
  return text.match("l.");
}

function matchAll(text) {
  return Array.from(text.matchAll(/(l)(x)?/g), found => [found[0], found[1], found[2], found.index]);
}

function search(text) {
  return text.search(/o/);
}

function firstWord(text) {
  const found = text.match(/^(\w+)/);
  return found ? found[1].length : -1;
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
  ["match", "match", match],
  ["match", "match every", matchEvery],
  ["match", "match text", matchText],
  ["matchAll", "matchAll", matchAll],
  ["search", "search", search],
  ["match", "first word", firstWord],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += match("hello")[0].length + matchEvery("hello").length + matchText("hello").index + matchAll("hello").length + search("hello") + firstWord("hello world");
}
console.log("2000 honest rounds", total);

for (const [member, name, use] of uses) {
  for (const text of receivers(member)) attempt(name + " in " + text, () => use(make(text)));
  attempt(name + " in a string again", () => use("hello world"));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
