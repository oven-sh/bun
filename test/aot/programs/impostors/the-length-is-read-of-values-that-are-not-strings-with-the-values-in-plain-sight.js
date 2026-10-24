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
  "'hello'": () => ('hello'),
  "''": () => (''),
  "'ab'.repeat(3) + 'c'": () => ('ab'.repeat(3) + 'c'),
  "'\\ud83d\\ude00'": () => ('\ud83d\ude00'),
  "new String('hello')": () => (new String('hello')),
  "new String('')": () => (new String('')),
  "Object.setPrototypeOf(new String('hello'), null)": () => (Object.setPrototypeOf(new String('hello'), null)),
  "Object.create(new String('hello'))": () => (Object.create(new String('hello'))),
  "Object.create('hello'.__proto__)": () => (Object.create('hello'.__proto__)),
  "String.prototype": () => (String.prototype),
  "['h', 'i']": () => (['h', 'i']),
  "[]": () => ([]),
  "[,,,]": () => ([,,,]),
  "Object.assign([], { length: 4294967295 })": () => (Object.assign([], { length: 4294967295 })),
  "Buffer.from('h\\u00e9llo')": () => (Buffer.from('h\u00e9llo')),
  "new Uint16Array(3)": () => (new Uint16Array(3)),
  "new ArrayBuffer(8)": () => (new ArrayBuffer(8)),
  "function two(a, b) {}": () => (function two(a, b) {}),
  "class One { constructor(a) {} }": () => (class One { constructor(a) {} }),
  "(function () { return arguments; })(1, 2, 3)": () => ((function () { return arguments; })(1, 2, 3)),
  "{ length: 5 }": () => ({ length: 5 }),
  "{ length: '5' }": () => ({ length: '5' }),
  "{ length: -0 }": () => ({ length: -0 }),
  "{ length: 2.5 }": () => ({ length: 2.5 }),
  "{ length: null }": () => ({ length: null }),
  "{ length: { valueOf() { log.push('valueOf'); return 5; } } }": () => ({ length: { valueOf() { log.push('valueOf'); return 5; } } }),
  "{ get length() { log.push('get length'); return 5; } }": () => ({ get length() { log.push('get length'); return 5; } }),
  "{ get length() { throw new RangeError('no'); } }": () => ({ get length() { throw new RangeError('no'); } }),
  "Object.create({ length: 7 })": () => (Object.create({ length: 7 })),
  "{}": () => ({}),
  "new Map([[1, 2]])": () => (new Map([[1, 2]])),
  "new Set('abc')": () => (new Set('abc')),
  "5": () => (5),
  "5n": () => (5n),
  "true": () => (true),
  "Symbol('hello')": () => (Symbol('hello')),
  "null": () => (null),
  "undefined": () => (undefined),
  "new Proxy('hello'.split(''), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })": () => (new Proxy('hello'.split(''), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })),
  "new Proxy(new String('hello'), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })": () => (new Proxy(new String('hello'), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })),
};

function make(text) {
  return made[text]();
}

function lengthOf(text) {
  return text.length;
}

function isEmpty(text) {
  return text.length === 0;
}

function isLongerThanThree(text) {
  return text.length > 3;
}

function lengthIfAny(text) {
  return text?.length;
}

function lengthByDestructuring({ length }) {
  return length;
}

function totalLength(texts) {
  let total = 0;
  for (let i = 0; i < texts.length; i++) total += texts[i].length;
  return total;
}

const log = [];
globalThis.log = log;

const texts = [
  "'hello'",
  "''",
  "'ab'.repeat(3) + 'c'",
  "'\\ud83d\\ude00'",
  "new String('hello')",
  "new String('')",
  "Object.setPrototypeOf(new String('hello'), null)",
  "Object.create(new String('hello'))",
  "Object.create('hello'.__proto__)",
  "String.prototype",
  "['h', 'i']",
  "[]",
  "[,,,]",
  "Object.assign([], { length: 4294967295 })",
  "Buffer.from('h\\u00e9llo')",
  "new Uint16Array(3)",
  "new ArrayBuffer(8)",
  "function two(a, b) {}",
  "class One { constructor(a) {} }",
  "(function () { return arguments; })(1, 2, 3)",
  "{ length: 5 }",
  "{ length: '5' }",
  "{ length: -0 }",
  "{ length: 2.5 }",
  "{ length: null }",
  "{ length: { valueOf() { log.push('valueOf'); return 5; } } }",
  "{ get length() { log.push('get length'); return 5; } }",
  "{ get length() { throw new RangeError('no'); } }",
  "Object.create({ length: 7 })",
  "{}",
  "new Map([[1, 2]])",
  "new Set('abc')",
  "5",
  "5n",
  "true",
  "Symbol('hello')",
  "null",
  "undefined",
  "new Proxy('hello'.split(''), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })",
  "new Proxy(new String('hello'), { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); } })",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += lengthOf("hello") + lengthIfAny("hi") + lengthByDestructuring("hey") + totalLength(["a", "bc"]);
  if (isEmpty("")) total++;
  if (isLongerThanThree("hello")) total++;
}
console.log("2000 honest rounds", total);

for (const text of texts) {
  attempt("length of " + text, () => lengthOf(make(text)));
  attempt("is empty " + text, () => isEmpty(make(text)));
  attempt("is longer than three " + text, () => isLongerThanThree(make(text)));
  attempt("length if any of " + text, () => lengthIfAny(make(text)));
  attempt("length by destructuring " + text, () => lengthByDestructuring(make(text)));
  attempt("total with " + text, () => totalLength(["ab", make(text), "c"]));
  if (log.length) console.log("log", log.splice(0).join(", "));
}
attempt("honest again", () => [lengthOf("hello"), isEmpty("hello"), isLongerThanThree("hello"), lengthIfAny("hello"), lengthByDestructuring("hello"), totalLength(["hello"])]);
