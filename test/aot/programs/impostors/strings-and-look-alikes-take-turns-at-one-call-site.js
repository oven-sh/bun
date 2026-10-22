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

function hash(text) {
  let result = 7;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

function firstAndLast(text) {
  return text[0] + "-" + text[text.length - 1];
}

function shout(text) {
  return text.toUpperCase();
}

function label(text) {
  return "<" + text + ">";
}

function isAbc(text) {
  return text === "abc";
}

function lookUp(table, key) {
  return table[key];
}

const lookAlike = {
  length: 3,
  0: "x",
  2: "z",
  charCodeAt(index) {
    return 100 + index;
  },
  toUpperCase() {
    return "LOOK ALIKE";
  },
  toString() {
    return "look alike";
  },
};

const turns = [
  "abc",
  lookAlike,
  "abc",
  new String("abc"),
  "abc",
  Object.assign(["a", "b", "c"], { charCodeAt: () => 1, toUpperCase: () => "LIST" }),
  "abc",
  "世界人",
  "abc",
  "ab" + make("'c'"),
  "",
  Object.assign(Buffer.from("abc"), { charCodeAt: () => 2, toUpperCase: () => "BYTES" }),
];

const table = { abc: "by text", "look alike": "by the look-alike", "a,b,c": "by the list", "": "by the empty text", "世界人": "by the wide text" };

const sums = new Map();
function note(name, value) {
  const line = show(value);
  const key = name + " " + line;
  sums.set(key, (sums.get(key) || 0) + 1);
}

for (let i = 0; i < 2400; i++) {
  const value = turns[i % turns.length];
  note("hash", hash(value));
  note("first and last", firstAndLast(value));
  note("shout", shout(value));
  note("label", label(value));
  note("is abc", isAbc(value));
  note("look up", lookUp(table, value));
}

for (const [key, count] of sums) console.log(key, "x", count);

function runs(pattern) {
  const seen = [];
  for (let i = 0; i < pattern.length; i++) {
    const value = pattern[i] === "s" ? "abc" : pattern[i] === "o" ? lookAlike : pattern[i] === "w" ? new String("abc") : null;
    try {
      seen.push(hash(value) + ":" + shout(value) + ":" + isAbc(value));
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  return seen.join(" ");
}

console.log("s o s:", runs("sos"));
console.log("o s o:", runs("oso"));
console.log("s n s:", runs("sns"));
console.log("w s w:", runs("wsw"));
console.log("s s s o o o s s s w w w n s:", runs("sssooossswwwns"));
