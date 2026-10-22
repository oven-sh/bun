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

function hasLength(value) {
  return "length" in value;
}

function hasZero(value) {
  return 0 in value;
}

function hasKey(value, key) {
  return key in value;
}

function countKeys(value) {
  let count = 0;
  for (const key in value) count++;
  return count;
}

function hasLengthThenReadsIt(value) {
  return "length" in value ? value.length : "none";
}

function readsThenAsks(value) {
  const length = value.length;
  return [length, "length" in value];
}

function spreadIntoAnObject(value) {
  return { ...value };
}

function restOf(value) {
  const { length, ...rest } = value;
  return [length, rest];
}

const log = [];
globalThis.log = log;

const values = [
  "{ length: 1, 0: 'x' }",
  "{}",
  "['x']",
  "[]",
  "[,]",
  "'x'",
  "''",
  "new String('x')",
  "new String('')",
  "5",
  "NaN",
  "5n",
  "true",
  "Symbol('x')",
  "null",
  "undefined",
  "function f(a) {}",
  "new Uint8Array(1)",
  "new Uint8Array(0)",
  "Buffer.from('x')",
  "Object.create(null)",
  "Object.create({ length: 1, 0: 'inherited' })",
  "(function () { return arguments; })('x')",
  "new Map([[0, 'x']])",
  "new Proxy({}, { has(target, key) { log.push('has ' + typeof key + ' ' + String(key)); return true; }, get(target, key) { log.push('get ' + String(key)); return 'got'; }, ownKeys() { log.push('ownKeys'); return []; } })",
  "new Proxy(['x'], { has(target, key) { log.push('has ' + typeof key + ' ' + String(key)); return key in target; } })",
];

const uses = [
  ["'length' in", hasLength],
  ["0 in", hasZero],
  ["'0' in", value => hasKey(value, "0")],
  ["keys of", countKeys],
  ["asks then reads", hasLengthThenReadsIt],
  ["reads then asks", readsThenAsks],
  ["spread of", spreadIntoAnObject],
  ["rest of", restOf],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: 1, 0: "x" };
  if (hasLength(honest)) total++;
  if (hasZero(honest)) total++;
  if (hasKey(honest, "0")) total++;
  total += countKeys(honest) + hasLengthThenReadsIt(honest) + readsThenAsks(honest)[0] + Object.keys(spreadIntoAnObject(honest)).length + restOf(honest)[0];
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " " + text, () => use(make(text)));
    if (log.length) console.log("log", log.splice(0).join(", "));
  }
}

console.log("bytes made in plain sight", Buffer.from("he").length);
