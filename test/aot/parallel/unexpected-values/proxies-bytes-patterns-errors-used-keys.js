// Proxies bytes patterns and errors are used as keys.
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

const log = [];
globalThis.log = log;

function read(table, key) {
  return table[key];
}

function store(key) {
  const table = {};
  table[key] = 1;
  return Reflect.ownKeys(table).map(name => typeof name + " " + String(name));
}

function isIn(table, key) {
  return key in table;
}

function literal(key) {
  return Object.keys({ [key]: 1 });
}

function inAMap(key) {
  const map = new Map([["a", "by the text a"], ["1", "by the text 1"]]);
  return [map.get(key), map.has(key)];
}

function inAList(key) {
  return ["zero", "one", "two"][key];
}

function inAText(key) {
  return "xyz"[key];
}

const table = { a: "a", 1: "1", "1,2": "1,2", "/a/g": "/a/g", "Error: a": "Error: a", "RangeError": "RangeError", "[object Object]": "[object Object]", "[object Map]": "[object Map]", "[object Promise]": "[object Promise]", "[object Math]": "[object Math]", "[object Arguments]": "[object Arguments]", "[object Generator]": "[object Generator]", "[object Tagged]": "[object Tagged]", "": "empty", true: "true", "1n": "1n" };

const keys = [
  "Buffer.from('a')",
  "Buffer.from('1')",
  "Buffer.alloc(0)",
  "new Uint8Array([1])",
  "new Uint8Array([1, 2])",
  "new Uint8Array(0)",
  "new Float64Array([1.0])",
  "new BigInt64Array([1n])",
  "/a/g",
  "new Error('a')",
  "new RangeError()",
  "new Map()",
  "new Set(['a'])",
  "Promise.resolve('a')",
  "Math",
  "(function () { return arguments; })('a')",
  "(function* () {})()",
  "{ [Symbol.toStringTag]: 'Tagged' }",
  "new Boolean(true)",
  "Object(1n)",
  "new (class extends String {})('a')",
  "new (class extends Number {})(1)",
  "new (class extends Array {})()",
  "class extends Array {}.of('a')",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return undefined; } })",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'toString' ? () => 'a' : undefined; } })",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === Symbol.toPrimitive ? hint => (log.push(hint), 'a') : undefined; } })",
  "new Proxy(new String('a'), {})",
  "new Proxy(['a'], {})",
  "new Proxy([1, 2], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })",
  "new Proxy(function () {}, { get(target, key) { return key === 'toString' ? () => '1' : undefined; } })",
  "Object.assign(() => {}, { toString() { return 'a'; } })",
  "Object.assign(['x'], { toString() { return 'a'; } })",
  "Object.assign(['x'], { join() { log.push('join'); return 'a'; } })",
  "Object.assign([1], { valueOf() { log.push('valueOf'); return 2; } })",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += read(table, "a").length + store("a").length + literal("a").length + inAMap("a").length + inAList(1).length + inAText(1).length;
  if (isIn(table, "a")) total++;
}
console.log("2000 honest rounds", total);

const uses = [
  ["read", key => read(table, key)],
  ["store", store],
  ["in", key => isIn(table, key)],
  ["literal", literal],
  ["map", inAMap],
  ["list", inAList],
  ["text", inAText],
];

for (const text of keys) {
  console.log(text + " -> " + uses.map(([name, use]) => {
    try {
      return name + " " + show(use(make(text)));
    } catch (error) {
      return name + " threw " + error.constructor.name;
    }
  }).join("; "));
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
