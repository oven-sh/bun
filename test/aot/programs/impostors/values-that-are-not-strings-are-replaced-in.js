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

function replaceText(text) {
  return text.replace("l", "L");
}

function replaceAllText(text) {
  return text.replaceAll("l", "L");
}

function replaceWithACallback(text) {
  return text.replace("o", (match, offset, whole) => "<" + match + offset + typeof whole + ">");
}

function replaceAllWithACallback(text) {
  return text.replaceAll("o", (match, offset) => "<" + match + offset + ">");
}

function replaceAPattern(text) {
  return text.replace(/l+/g, "_");
}

function replaceWithDollars(text) {
  return text.replace("o", "[$&|$`|$'|$$|$1]");
}

function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  ["replace", "replace text", replaceText],
  ["replaceAll", "replaceAll text", replaceAllText],
  ["replace", "replace with a callback", replaceWithACallback],
  ["replaceAll", "replaceAll with a callback", replaceAllWithACallback],
  ["replace", "replace a pattern", replaceAPattern],
  ["replace", "replace with dollars", replaceWithDollars],
  ["replace", "escape", escape],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += replaceText("hello").length + replaceAllText("hello").length + replaceWithACallback("hello").length + replaceAllWithACallback("foo").length;
  total += replaceAPattern("hello").length + replaceWithDollars("hello").length + escape("a<b>&c").length;
}
console.log("2000 honest rounds", total);

for (const [member, name, use] of uses) {
  for (const text of receivers(member)) attempt(name + " in " + text, () => use(make(text)));
  attempt(name + " in a string again", () => use("hello world"));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
