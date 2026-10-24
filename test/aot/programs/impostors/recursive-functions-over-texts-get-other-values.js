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

function reversed(text) {
  return text.length === 0 ? text : reversed(text.slice(1)).concat(text[0]);
}

function countA(text, from) {
  if (from >= text.length) return 0;
  return (text[from] === "a" ? 1 : 0) + countA(text, from + 1);
}

function isPalindrome(text) {
  if (text.length < 2) return true;
  return text[0] === text[text.length - 1] && isPalindrome(text.slice(1, -1));
}

function depth(text, from, level) {
  if (from === text.length || from > 20) return level;
  const character = text.charAt(from);
  return depth(text, from + 1, character === "(" ? level + 1 : character === ")" ? level - 1 : level);
}

function permutations(text) {
  if (text.length <= 1) return [text];
  const found = [];
  for (let i = 0; i < text.length; i++) {
    for (const rest of permutations(text.slice(0, i).concat(text.slice(i + 1)))) found.push(text.slice(i, i + 1).concat(rest));
  }
  return found;
}

function isEven(text) {
  return text.length === 0 ? true : isOdd(text.slice(1));
}

function isOdd(text) {
  return text.length === 0 ? false : isEven(text.slice(1));
}

function flattenToText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenToText).join("");
  return "<" + String(value) + ">";
}

const uses = [
  ["reversed", reversed],
  ["count of a", value => countA(value, 0)],
  ["is a palindrome", isPalindrome],
  ["depth", value => depth(value, 0, 0)],
  ["permutations", permutations],
  ["is even", isEven],
  ["flatten", flattenToText],
];

const values = [
  "'aba'",
  "'abc'",
  "''",
  "'(a(b))'",
  "'\\ud83d\\ude00a'",
  "'a' + 'ba'",
  "new String('aba')",
  "['a', 'b', 'a']",
  "['a', ['b'], 'a']",
  "[]",
  "Buffer.from('aba')",
  "new Uint8Array([1, 2, 1])",
  "{ length: 0 }",
  "{ length: 1, 0: 'a' }",
  "5",
  "null",
  "undefined",
  "['a', 5, null, ['b', [undefined, 'c']], new String('d')]",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("aba")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) attempt(name + " of " + text, () => use(make(text)));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
