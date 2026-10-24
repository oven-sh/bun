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

function lastElement(value) {
  return value[value.length - 1];
}

function withoutFirst(value) {
  return value.slice(1);
}

function positionOfB(value) {
  return value.indexOf("b");
}

function hasB(value) {
  return value.includes("b");
}

function joinedWithItself(value) {
  return value.concat(value);
}

function lastByAt(value) {
  return value.at(-1);
}

function reversedCopy(value) {
  let result = value.slice(0, 0);
  for (let i = value.length - 1; i >= 0; i--) result = result.concat(value[i]);
  return result;
}

function isPalindrome(value) {
  for (let i = 0, j = value.length - 1; i < j; i++, j--) {
    if (value[i] !== value[j]) return false;
  }
  return true;
}

const uses = [
  ["last element", lastElement],
  ["without first", withoutFirst],
  ["position of b", positionOfB],
  ["has b", hasB],
  ["joined with itself", joinedWithItself],
  ["last by at", lastByAt],
  ["reversed copy", reversedCopy],
  ["is palindrome", isPalindrome],
];

const values = [
  "'abc'",
  "['a', 'b', 'c']",
  "'aba'",
  "['a', 'b', 'a']",
  "''",
  "[]",
  "'b'",
  "['b']",
  "[['b']]",
  "['abc']",
  "new String('abc')",
  "Buffer.from('abc')",
  "new Uint8Array([97, 98, 99])",
  "[, 'b', ,]",
  "class Letters extends Array { slice() { return 'sliced by the subclass'; } indexOf() { return 'found by the subclass'; } }.from('abc')",
  "(function () { return arguments; })('a', 'b', 'c')",
  "{ 0: 'a', 1: 'b', length: 2 }",
  "{ 0: 'a', 1: 'b', length: 2, slice: Array.prototype.slice, indexOf: String.prototype.indexOf, includes: Array.prototype.includes, concat: String.prototype.concat, at: Array.prototype.at }",
  "{ 0: 'a', 1: 'b', length: 2, slice: String.prototype.slice, indexOf: Array.prototype.indexOf, includes: String.prototype.includes, concat: Array.prototype.concat, at: String.prototype.at, toString() { return 'xby'; } }",
  "123",
  "null",
];

for (let round = 0; round < 2; round++) {
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    const honest = round === 0 ? "abc" : ["a", "b", "c"];
    total += lastElement(honest).length + withoutFirst(honest).length + positionOfB(honest) + joinedWithItself(honest).length + lastByAt(honest).length + reversedCopy(honest).length;
    if (hasB(honest)) total++;
    if (isPalindrome(honest)) total++;
  }
  console.log("1000 rounds of " + (round === 0 ? "texts" : "lists"), total);
  for (const [name, use] of uses) {
    for (const text of values) attempt(round + " " + name + " of " + text, () => use(make(text)));
  }
}

console.log("bytes made in plain sight", Buffer.from("he").length);
