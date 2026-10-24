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

const made = {
  "'hello world'": () => ('hello world'),
  "''": () => (''),
  "'hello'.concat(' ', 'world')": () => ('hello'.concat(' ', 'world')),
  "'h\\u00e9llo w\\u4e16rld'": () => ('h\u00e9llo w\u4e16rld'),
  "'\\ud83d\\ude00 \\ud83d alone'": () => ('\ud83d\ude00 \ud83d alone'),
  "new String('hello world')": () => (new String('hello world')),
  "Object.assign(new String('hello world'), { indexOf() { return 'own member'; } })": () => (Object.assign(new String('hello world'), { indexOf() { return 'own member'; } })),
  "Object.setPrototypeOf(new String('hello world'), { indexOf() { return 'other prototype'; } })": () => (Object.setPrototypeOf(new String('hello world'), { indexOf() { return 'other prototype'; } })),
  "Object.setPrototypeOf(new String('hello world'), null)": () => (Object.setPrototypeOf(new String('hello world'), null)),
  "{ indexOf(...given) { return 'mine ' + given.length; } }": () => ({ indexOf(...given) { return 'mine ' + given.length; } }),
  "{ indexOf: String.prototype.indexOf, toString() { return 'borrowed method'; } }": () => ({ indexOf: String.prototype.indexOf, toString() { return 'borrowed method'; } }),
  "{ indexOf: 5 }": () => ({ indexOf: 5 }),
  "{}": () => ({}),
  "['h', 'e', 'l', 'l', 'o', ' ', 'w']": () => (['h', 'e', 'l', 'l', 'o', ' ', 'w']),
  "Buffer.from('hello world')": () => (Buffer.from('hello world')),
  "new Uint8Array([104, 101, 108, 108, 111])": () => (new Uint8Array([104, 101, 108, 108, 111])),
  "12345": () => (12345),
  "-0": () => (-0),
  "12345n": () => (12345n),
  "Symbol('hello')": () => (Symbol('hello')),
  "true": () => (true),
  "null": () => (null),
  "undefined": () => (undefined),
  "new Proxy(new String('hello world'), {})": () => (new Proxy(new String('hello world'), {})),
  "new Proxy({}, { get(target, key) { return () => 'trapped ' + String(key); } })": () => (new Proxy({}, { get(target, key) { return () => 'trapped ' + String(key); } })),
  "Object.assign(new String('hello world'), { lastIndexOf() { return 'own member'; } })": () => (Object.assign(new String('hello world'), { lastIndexOf() { return 'own member'; } })),
  "Object.setPrototypeOf(new String('hello world'), { lastIndexOf() { return 'other prototype'; } })": () => (Object.setPrototypeOf(new String('hello world'), { lastIndexOf() { return 'other prototype'; } })),
  "{ lastIndexOf(...given) { return 'mine ' + given.length; } }": () => ({ lastIndexOf(...given) { return 'mine ' + given.length; } }),
  "{ lastIndexOf: String.prototype.lastIndexOf, toString() { return 'borrowed method'; } }": () => ({ lastIndexOf: String.prototype.lastIndexOf, toString() { return 'borrowed method'; } }),
  "{ lastIndexOf: 5 }": () => ({ lastIndexOf: 5 }),
  "Object.assign(new String('hello world'), { includes() { return 'own member'; } })": () => (Object.assign(new String('hello world'), { includes() { return 'own member'; } })),
  "Object.setPrototypeOf(new String('hello world'), { includes() { return 'other prototype'; } })": () => (Object.setPrototypeOf(new String('hello world'), { includes() { return 'other prototype'; } })),
  "{ includes(...given) { return 'mine ' + given.length; } }": () => ({ includes(...given) { return 'mine ' + given.length; } }),
  "{ includes: String.prototype.includes, toString() { return 'borrowed method'; } }": () => ({ includes: String.prototype.includes, toString() { return 'borrowed method'; } }),
  "{ includes: 5 }": () => ({ includes: 5 }),
  "Object.assign(new String('hello world'), { startsWith() { return 'own member'; } })": () => (Object.assign(new String('hello world'), { startsWith() { return 'own member'; } })),
  "Object.setPrototypeOf(new String('hello world'), { startsWith() { return 'other prototype'; } })": () => (Object.setPrototypeOf(new String('hello world'), { startsWith() { return 'other prototype'; } })),
  "{ startsWith(...given) { return 'mine ' + given.length; } }": () => ({ startsWith(...given) { return 'mine ' + given.length; } }),
  "{ startsWith: String.prototype.startsWith, toString() { return 'borrowed method'; } }": () => ({ startsWith: String.prototype.startsWith, toString() { return 'borrowed method'; } }),
  "{ startsWith: 5 }": () => ({ startsWith: 5 }),
  "Object.assign(new String('hello world'), { endsWith() { return 'own member'; } })": () => (Object.assign(new String('hello world'), { endsWith() { return 'own member'; } })),
  "Object.setPrototypeOf(new String('hello world'), { endsWith() { return 'other prototype'; } })": () => (Object.setPrototypeOf(new String('hello world'), { endsWith() { return 'other prototype'; } })),
  "{ endsWith(...given) { return 'mine ' + given.length; } }": () => ({ endsWith(...given) { return 'mine ' + given.length; } }),
  "{ endsWith: String.prototype.endsWith, toString() { return 'borrowed method'; } }": () => ({ endsWith: String.prototype.endsWith, toString() { return 'borrowed method'; } }),
  "{ endsWith: 5 }": () => ({ endsWith: 5 }),
};

function make(text) {
  return made[text]();
}

function indexOf(text, piece) {
  return text.indexOf(piece);
}

function lastIndexOf(text, piece) {
  return text.lastIndexOf(piece);
}

function includes(text, piece) {
  return text.includes(piece);
}

function startsWith(text, piece) {
  return text.startsWith(piece);
}

function endsWith(text, piece) {
  return text.endsWith(piece);
}

function countOccurrences(text, piece) {
  let count = 0;
  let from = 0;
  while (count < 5) {
    const found = text.indexOf(piece, from);
    if (found === -1 || found === undefined || typeof found !== "number") break;
    count++;
    from = found + 1;
  }
  return count;
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
  ["indexOf", value => indexOf(value, "l")],
  ["lastIndexOf", value => lastIndexOf(value, "l")],
  ["includes", value => includes(value, "l")],
  ["startsWith", value => startsWith(value, "h")],
  ["endsWith", value => endsWith(value, "d")],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += indexOf("hello world", "o") + lastIndexOf("hello world", "o") + countOccurrences("hello world", "l");
  if (includes("hello world", "wor")) total++;
  if (startsWith("hello world", "hell")) total++;
  if (endsWith("hello world", "rld")) total++;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of receivers(name)) attempt(name + " in " + text, () => use(make(text)));
  attempt(name + " in a string again", () => use("hello world"));
}
for (const text of receivers("indexOf")) attempt("occurrences in " + text, () => countOccurrences(make(text), "l"));

attempt("a number is looked for in a list and in a text", () => [indexOf([1, 2, 3], 2), indexOf("123", 2), indexOf(["1", "2"], 2), includes([NaN], NaN), indexOf([NaN], NaN), includes("NaN", NaN)]);
attempt("a byte is looked for in bytes", () => [indexOf(Buffer.from("hello"), 108), indexOf(Buffer.from("hello"), "l"), indexOf(new Uint8Array([104, 108]), 108), indexOf(new Uint8Array([104, 108]), "l"), includes(Buffer.from("hello"), "ell")]);
attempt("undefined is looked for", () => [indexOf("undefined", undefined), includes([undefined], undefined), includes([,], undefined), indexOf([,], undefined), includes("x", undefined)]);
