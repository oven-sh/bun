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

function first(text) {
  return text[0];
}

function third(text) {
  return text[2];
}

function elementAt(text, index) {
  return text[index];
}

function firstIfAny(text) {
  return text?.[0];
}

function hasThird(text) {
  return text[2] !== undefined;
}

function firstFour(text) {
  const found = [];
  for (let i = 0; i < 4; i++) found.push(text[i]);
  return found;
}

const log = [];
globalThis.log = log;

const texts = [
  "'hello'",
  "'hi'",
  "''",
  "'a' + 'b'.repeat(2)",
  "'\\ud83d\\ude00x'",
  "'\\u4e16\\u754c\\u4eba'",
  "new String('hello')",
  "new String('hi')",
  "Object.assign(new String('hi'), { 2: 'own third' })",
  "Object.setPrototypeOf(new String('hi'), { 2: 'inherited third' })",
  "Object.create(new String('hello'))",
  "['h', 'e', 'l']",
  "['h', , 'l']",
  "[1.5, -0, NaN]",
  "Object.setPrototypeOf(['h'], { 2: 'inherited third' })",
  "Buffer.from('hello')",
  "new Uint8Array(2)",
  "new Float64Array([0.5, -0, NaN])",
  "new BigInt64Array([1n, 2n, 3n])",
  "(function () { return arguments; })('a', 'b')",
  "{ 0: 'zero', 2: 'two' }",
  "{ '0': 'zero', '2': 'two', '02': 'not two' }",
  "{ get 0() { log.push('get 0'); return 'zero'; }, get 2() { log.push('get 2'); return 'two'; } }",
  "Object.create({ 0: 'inherited zero' })",
  "function f() {}",
  "new Map([[0, 'zero']])",
  "123",
  "123n",
  "true",
  "Symbol('abc')",
  "null",
  "undefined",
  "new Proxy({}, { get(target, key) { log.push(typeof key + ' ' + String(key)); return 'trapped'; } })",
  "new Proxy(new String('hello'), { get(target, key, receiver) { log.push(typeof key + ' ' + String(key)); return Reflect.get(target, key, receiver); } })",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += first("hello").length + third("hello").length + elementAt("hello", i % 5).length + firstIfAny("hello").length + firstFour("hello").length;
  if (hasThird("hello")) total++;
}
console.log("2000 honest rounds", total);

for (const text of texts) {
  attempt("first of " + text, () => first(make(text)));
  attempt("third of " + text, () => third(make(text)));
  attempt("element 1 of " + text, () => elementAt(make(text), 1));
  attempt("first if any of " + text, () => firstIfAny(make(text)));
  attempt("has a third " + text, () => hasThird(make(text)));
  attempt("first four of " + text, () => firstFour(make(text)));
  if (log.length) console.log("log", log.splice(0).join(", "));
}
attempt("honest again", () => [first("hello"), third("hello"), elementAt("hello", 4), elementAt("hello", 5), firstIfAny(""), hasThird("hi"), firstFour("hi")]);

console.log("bytes made in plain sight", Buffer.from("he").length);
