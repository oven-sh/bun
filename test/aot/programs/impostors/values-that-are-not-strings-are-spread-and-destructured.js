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

function spreadIntoAList(text) {
  return [...text];
}

function spreadBetweenOthers(text) {
  return ["<", ...text, ">"];
}

function spreadIntoACall(text) {
  return collect(...text);
}

function collect(...given) {
  return given;
}

function firstAndSecond(text) {
  const [first, second] = text;
  return [first, second];
}

function firstAndRest(text) {
  const [first, ...rest] = text;
  return [first, rest];
}

function withDefaults(text) {
  const [first = "default first", , third = "default third"] = text;
  return [first, third];
}

function byArrayFrom(text) {
  return Array.from(text);
}

const log = [];
globalThis.log = log;

const values = [
  "'hey'",
  "''",
  "'a' + 'bc'",
  "'\\ud83d\\ude00x'",
  "'x\\ud83d'",
  "'\\ude00\\ud83d'",
  "'e\\u0301'",
  "'\\u4e16\\u754c'",
  "new String('hey')",
  "Object.assign(new String('hey'), { *[Symbol.iterator]() { log.push('own iterator'); yield 'own'; } })",
  "Object.setPrototypeOf(new String('hey'), { *[Symbol.iterator]() { log.push('inherited iterator'); yield 'inherited'; } })",
  "Object.setPrototypeOf(new String('hey'), null)",
  "Object.assign(new String('hey'), { [Symbol.iterator]: undefined })",
  "['h', 'e', 'y']",
  "['h', , 'y']",
  "[]",
  "Object.assign(['h'], { *[Symbol.iterator]() { log.push('own iterator of a list'); yield 'own'; } })",
  "Buffer.from('hey')",
  "new Uint8Array([1, 2])",
  "new Set('hello')",
  "new Map([['h', 1], ['e', 2]])",
  "(function* () { log.push('started'); try { yield 'first'; yield 'second'; yield 'third'; yield 'fourth'; } finally { log.push('closed'); } })()",
  "(function () { return arguments; })('h', 'e')",
  "'hey'[Symbol.iterator]()",
  "['h', 'e'].entries()",
  "'hey'.matchAll(/./g)",
  "{ length: 2, 0: 'h', 1: 'e' }",
  "{ [Symbol.iterator]() { log.push('iterator'); let n = 0; return { next() { log.push('next'); return { done: n++ >= 5, value: 'v' + n }; }, return() { log.push('return'); return {}; } }; } }",
  "{ [Symbol.iterator]() { return { next() { return 5; } }; } }",
  "{ [Symbol.iterator]() { return 5; } }",
  "{ [Symbol.iterator]: 5 }",
  "{ [Symbol.iterator]() { return { get next() { log.push('get next'); return () => ({ done: true }); } }; } }",
  "{ [Symbol.iterator]() { return { next() { throw new RangeError('no'); }, return() { log.push('return'); return {}; } }; } }",
  "{}",
  "5",
  "5n",
  "true",
  "Symbol('hey')",
  "null",
  "undefined",
  "function f() {}",
  "new Proxy(['h', 'e'], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })",
  "new Proxy(new String('he'), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += spreadIntoAList("hey").length + spreadBetweenOthers("hey").length + spreadIntoACall("hey").length + firstAndSecond("hey").length + firstAndRest("hey").length + withDefaults("hey").length + byArrayFrom("hey").length;
}
console.log("2000 honest rounds", total);

const uses = [
  ["[...x]", spreadIntoAList],
  ["['<', ...x, '>']", spreadBetweenOthers],
  ["f(...x)", spreadIntoACall],
  ["[a, b] = x", firstAndSecond],
  ["[a, ...b] = x", firstAndRest],
  ["[a = .., , c = ..] = x", withDefaults],
  ["Array.from(x)", byArrayFrom],
];

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " with " + text, () => use(make(text)));
    if (log.length) console.log("log", log.splice(0).join(", "));
  }
}

console.log("bytes made in plain sight", Buffer.from("he").length);
