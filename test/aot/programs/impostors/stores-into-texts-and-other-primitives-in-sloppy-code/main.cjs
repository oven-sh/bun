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

function storeMember(text, value) {
  text.member = value;
  return text.member;
}

function storeIndex(text, value) {
  text[0] = value;
  return text[0];
}

function storePastTheEnd(text, value) {
  text[9] = value;
  return text[9];
}

function storeLength(text, value) {
  text.length = value;
  return text.length;
}

function storeByKey(text, key, value) {
  text[key] = value;
  return text[key];
}

function removeIndex(text) {
  return delete text[0];
}

function removeLength(text) {
  return delete text.length;
}

function removeMissing(text) {
  return delete text.missing;
}

function addToMember(text) {
  text.count += 1;
  return text.count;
}

function incrementLength(text) {
  text.length++;
  return text.length;
}

function assignIfMissing(text) {
  text.member ??= "assigned";
  return text.member;
}

function fillLikeAList(text) {
  for (let i = 0; i < text.length; i++) text[i] = "x";
  return text;
}

const uses = [
  ["store a member", value => storeMember(value, 1)],
  ["store an index", value => storeIndex(value, "x")],
  ["store past the end", value => storePastTheEnd(value, "x")],
  ["store the length", value => storeLength(value, 1)],
  ["store by the key 1", value => storeByKey(value, "1", "x")],
  ["store by the key length", value => storeByKey(value, "length", 0)],
  ["store by a symbol", value => storeByKey(value, Symbol.for("s"), "x")],
  ["delete an index", removeIndex],
  ["delete the length", removeLength],
  ["delete a missing member", removeMissing],
  ["add to a member", addToMember],
  ["increment the length", incrementLength],
  ["assign if missing", assignIfMissing],
  ["fill like a list", fillLikeAList],
];

const values = [
  "[\"a\", \"b\", \"c\"]",
  "\"abc\"",
  "\"\"",
  "new String(\"abc\")",
  "Object.freeze(new String(\"abc\"))",
  "Object.freeze([\"a\", \"b\", \"c\"])",
  "{ length: 3, 0: \"a\" }",
  "new Uint8Array(3)",
  "Buffer.from(\"abc\")",
  "5",
  "true",
  "Symbol(\"s\")",
  "5n",
  "null",
  "undefined",
  "(function () { return arguments; })(\"a\", \"b\", \"c\")",
];

for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) {
    try {
      use(["a", "b", "c"]);
    } catch {}
  }
}

for (const [name, use] of uses) {
  for (const text of values) attempt(name + " of " + text, () => use(make(text)));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
