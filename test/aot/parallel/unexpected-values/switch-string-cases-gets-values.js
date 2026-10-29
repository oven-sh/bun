// A switch over string cases gets values that are not strings.
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

function kindOf(word) {
  switch (word) {
    case "if":
    case "else":
      return "branch";
    case "for":
    case "while":
      return "loop";
    case "function":
      return "function";
    case "":
      return "empty";
    case "1":
      return "the text one";
    case "null":
      return "the text null";
    case "undefined":
      return "the text undefined";
    case "été":
      return "summer";
    case "世界":
      return "world";
    case "\ud83d":
      return "half a pair";
    default:
      return "other";
  }
}

function mixedCases(value) {
  switch (value) {
    case "1":
      return "text 1";
    case 1:
      return "number 1";
    case "0":
      return "text 0";
    case 0:
      return "number 0";
    case null:
      return "null";
    case "null":
      return "text null";
    case undefined:
      return "undefined";
    case true:
      return "true";
    case "true":
      return "text true";
    case 1n:
      return "BigInt 1";
    case NaN:
      return "never";
  }
  return "nothing";
}

function fallsThrough(word) {
  const seen = [];
  switch (word) {
    case "a":
      seen.push("a");
    case "b":
      seen.push("b");
      break;
    default:
      seen.push("default");
    case "c":
      seen.push("c");
  }
  return seen.join("");
}

function sameLengthCases(word) {
  switch (word) {
    case "abcd":
      return 1;
    case "abce":
      return 2;
    case "bbcd":
      return 3;
    case "abcD":
      return 4;
  }
  return 0;
}

const log = [];
globalThis.log = log;

const values = [
  "'if'",
  "'i' + 'f'",
  "'whiles'.slice(0, 5)",
  "['func', 'tion'].join('')",
  "'function\\u4e16'.slice(0, 8)",
  "''",
  "'1'",
  "1",
  "1n",
  "0",
  "-0",
  "'0'",
  "NaN",
  "true",
  "'true'",
  "null",
  "'null'",
  "undefined",
  "'undefined'",
  "'\\u00e9t\\u00e9'",
  "'e\\u0301te\\u0301'",
  "'\\u4e16\\u754c'",
  "'\\ud83d'",
  "'\\ud83d\\ude00'.slice(0, 1)",
  "'\\ud83d\\ude00'",
  "new String('if')",
  "new String('')",
  "new String('a')",
  "['if']",
  "['a']",
  "{ toString() { log.push('toString'); return 'if'; }, valueOf() { log.push('valueOf'); return 'if'; } }",
  "Symbol('if')",
  "Symbol.for('a')",
  "'a'",
  "'b'",
  "'c'",
  "'d'",
  "'abcd'",
  "'abce'",
  "'bbcd'",
  "'abcD'",
  "'abc'",
  "'abcde'",
  "'IF'",
  "'if '",
  "Buffer.from('if')",
  "new Proxy(new String('if'), { get(target, key) { log.push('get ' + String(key)); return target[key]; } })",
];

let total = 0;
const honest = ["if", "else", "for", "while", "function", "", "x", "a", "b", "abcd"];
for (let i = 0; i < 2000; i++) {
  const word = honest[i % honest.length];
  total += kindOf(word).length + mixedCases(word).length + fallsThrough(word).length + sameLengthCases(word);
}
console.log("2000 honest rounds", total);

for (const text of values) {
  attempt(text, () => {
    const value = make(text);
    return [kindOf(value), mixedCases(value), fallsThrough(value), sameLengthCases(value)];
  });
  if (log.length) console.log("log", log.splice(0).join(", "));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
