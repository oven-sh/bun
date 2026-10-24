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

const made = {
  "'hey'": () => ('hey'),
  "''": () => (''),
  "'a' + 'bc'": () => ('a' + 'bc'),
  "'\\ud83d\\ude00x'": () => ('\ud83d\ude00x'),
  "'x\\ud83d'": () => ('x\ud83d'),
  "'\\ude00\\ud83d'": () => ('\ude00\ud83d'),
  "'e\\u0301'": () => ('e\u0301'),
  "'\\u4e16\\u754c'": () => ('\u4e16\u754c'),
  "new String('hey')": () => (new String('hey')),
  "Object.assign(new String('hey'), { *[Symbol.iterator]() { log.push('own iterator'); yield 'own'; } })": () => (Object.assign(new String('hey'), { *[Symbol.iterator]() { log.push('own iterator'); yield 'own'; } })),
  "Object.setPrototypeOf(new String('hey'), { *[Symbol.iterator]() { log.push('inherited iterator'); yield 'inherited'; } })": () => (Object.setPrototypeOf(new String('hey'), { *[Symbol.iterator]() { log.push('inherited iterator'); yield 'inherited'; } })),
  "Object.setPrototypeOf(new String('hey'), null)": () => (Object.setPrototypeOf(new String('hey'), null)),
  "Object.assign(new String('hey'), { [Symbol.iterator]: undefined })": () => (Object.assign(new String('hey'), { [Symbol.iterator]: undefined })),
  "['h', 'e', 'y']": () => (['h', 'e', 'y']),
  "['h', , 'y']": () => (['h', , 'y']),
  "[]": () => ([]),
  "Object.assign(['h'], { *[Symbol.iterator]() { log.push('own iterator of a list'); yield 'own'; } })": () => (Object.assign(['h'], { *[Symbol.iterator]() { log.push('own iterator of a list'); yield 'own'; } })),
  "Buffer.from('hey')": () => (Buffer.from('hey')),
  "new Uint8Array([1, 2])": () => (new Uint8Array([1, 2])),
  "new Set('hello')": () => (new Set('hello')),
  "new Map([['h', 1], ['e', 2]])": () => (new Map([['h', 1], ['e', 2]])),
  "(function* () { log.push('started'); try { yield 'first'; yield 'second'; yield 'third'; yield 'fourth'; } finally { log.push('closed'); } })()": () => ((function* () { log.push('started'); try { yield 'first'; yield 'second'; yield 'third'; yield 'fourth'; } finally { log.push('closed'); } })()),
  "(function () { return arguments; })('h', 'e')": () => ((function () { return arguments; })('h', 'e')),
  "'hey'[Symbol.iterator]()": () => ('hey'[Symbol.iterator]()),
  "['h', 'e'].entries()": () => (['h', 'e'].entries()),
  "'hey'.matchAll(/./g)": () => ('hey'.matchAll(/./g)),
  "{ length: 2, 0: 'h', 1: 'e' }": () => ({ length: 2, 0: 'h', 1: 'e' }),
  "{ [Symbol.iterator]() { log.push('iterator'); let n = 0; return { next() { log.push('next'); return { done: n++ >= 5, value: 'v' + n }; }, return() { log.push('return'); return {}; } }; } }": () => ({ [Symbol.iterator]() { log.push('iterator'); let n = 0; return { next() { log.push('next'); return { done: n++ >= 5, value: 'v' + n }; }, return() { log.push('return'); return {}; } }; } }),
  "{ [Symbol.iterator]() { return { next() { return 5; } }; } }": () => ({ [Symbol.iterator]() { return { next() { return 5; } }; } }),
  "{ [Symbol.iterator]() { return 5; } }": () => ({ [Symbol.iterator]() { return 5; } }),
  "{ [Symbol.iterator]: 5 }": () => ({ [Symbol.iterator]: 5 }),
  "{ [Symbol.iterator]() { return { get next() { log.push('get next'); return () => ({ done: true }); } }; } }": () => ({ [Symbol.iterator]() { return { get next() { log.push('get next'); return () => ({ done: true }); } }; } }),
  "{ [Symbol.iterator]() { return { next() { throw new RangeError('no'); }, return() { log.push('return'); return {}; } }; } }": () => ({ [Symbol.iterator]() { return { next() { throw new RangeError('no'); }, return() { log.push('return'); return {}; } }; } }),
  "{}": () => ({}),
  "5": () => (5),
  "5n": () => (5n),
  "true": () => (true),
  "Symbol('hey')": () => (Symbol('hey')),
  "null": () => (null),
  "undefined": () => (undefined),
  "function f() {}": () => (function f() {}),
  "new Proxy(['h', 'e'], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })": () => (new Proxy(['h', 'e'], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })),
  "new Proxy(new String('he'), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })": () => (new Proxy(new String('he'), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })),
};

function make(text) {
  return made[text]();
}

function characters(text) {
  const seen = [];
  for (const character of text) seen.push(character);
  return seen;
}

function countCharacters(text) {
  let count = 0;
  for (const character of text) count++;
  return count;
}

function firstTwo(text) {
  const seen = [];
  for (const character of text) {
    seen.push(character);
    if (seen.length === 2) break;
  }
  return seen;
}

function codesOfCharacters(text) {
  const seen = [];
  for (const character of text) seen.push(character.codePointAt(0));
  return seen;
}

function firstThatIsE(text) {
  for (const character of text) {
    if (character === "e") return "found";
  }
  return "not found";
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
  total += characters("hey").length + countCharacters("hey") + firstTwo("hey").length + codesOfCharacters("hey").length + firstThatIsE("hey").length;
}
console.log("2000 honest rounds", total);

const uses = [
  ["characters", characters],
  ["count", countCharacters],
  ["first two", firstTwo],
  ["codes", codesOfCharacters],
  ["first e", firstThatIsE],
];

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " of " + text, () => use(make(text)));
    if (log.length) console.log("log", log.splice(0).join(", "));
  }
  attempt(name + " of a string again", () => use("hey"));
}
