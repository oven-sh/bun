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

function keysAndTypes(value) {
  const seen = [];
  for (const key in value) seen.push(typeof key + " " + key);
  return seen;
}

function keysPlusOne(value) {
  const seen = [];
  for (const key in value) seen.push(key + 1);
  return seen;
}

function keysTimesTwo(value) {
  const seen = [];
  for (const key in value) seen.push(key * 2);
  return seen;
}

function sumOfKeys(value) {
  let total = 0;
  for (const key in value) total += key;
  return total;
}

function keysComparedWithNumbers(value) {
  const seen = [];
  for (const key in value) seen.push([key === 0, key == 0, key === "0", key < 1, key.length]);
  return seen;
}

function valuesByKey(value) {
  const seen = [];
  for (const key in value) seen.push(value[key]);
  return seen;
}

function nextByKey(value) {
  const seen = [];
  for (const key in value) seen.push(value[key + 1]);
  return seen;
}

function keysInASwitch(value) {
  const seen = [];
  for (const key in value) {
    switch (key) {
      case 0:
        seen.push("the number 0");
        break;
      case "0":
        seen.push("the text 0");
        break;
      default:
        seen.push("other");
    }
  }
  return seen;
}

const uses = [
  ["keys and types", keysAndTypes],
  ["keys plus one", keysPlusOne],
  ["keys times two", keysTimesTwo],
  ["sum of keys", sumOfKeys],
  ["compared with numbers", keysComparedWithNumbers],
  ["values by key", valuesByKey],
  ["next by key", nextByKey],
  ["in a switch", keysInASwitch],
];

const values = [
  "{ a: 1, b: 2 }",
  "['x', 'y', 'z']",
  "[10, 20, , 40]",
  "Object.assign(['x'], { extra: 'e', '-1': 'm', '01': 'n' })",
  "'hey'",
  "new String('hey')",
  "Object.assign(new String('hi'), { extra: 'e', 5: 'five' })",
  "new Uint8Array([7, 8])",
  "Buffer.from('ab').subarray(0, 2).length === 2 ? new Uint8Array(Buffer.from('ab')) : null",
  "(function () { return arguments; })('p', 'q')",
  "{ 2: 'two', 1: 'one', b: 'b', 0: 'zero', a: 'a', '-1': 'minus', '01': 'padded', 4294967294: 'large', 4294967295: 'too large', 1.5: 'fraction' }",
  "{ 11: 'eleven', 1: 'one', 0: 'zero', 10: 'ten', 1e3: 'thousand' }",
  "Object.create({ inherited: 1, 0: 'inherited zero' }, { own: { value: 2, enumerable: true }, hidden: { value: 3, enumerable: false } })",
  "Object.create({ shadowed: 1, seen: 2 }, { shadowed: { value: 3, enumerable: false } })",
  "{ [Symbol('s')]: 1, visible: 2 }",
  "new Map([['a', 1]])",
  "function f() {}",
  "Object.assign(function f() {}, { member: 1 })",
  "5",
  "true",
  "Symbol('s')",
  "5n",
  "null",
  "undefined",
  "''",
  "[]",
  "{}",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use({ a: 1, b: 2 })).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) attempt(name + " of " + text, () => use(make(text)));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
