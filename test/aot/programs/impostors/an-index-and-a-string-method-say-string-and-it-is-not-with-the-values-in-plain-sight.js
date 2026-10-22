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
  "'hello world'": () => ('hello world'),
  "''": () => (''),
  "new String('hello world')": () => (new String('hello world')),
  "Object.assign(new String('hi'), { charCodeAt() { return 'own'; }, toUpperCase() { return 'OWN'; }, substring() { return ' own'; }, trim() { return 'own trim'; } })": () => (Object.assign(new String('hi'), { charCodeAt() { return 'own'; }, toUpperCase() { return 'OWN'; }, substring() { return ' own'; }, trim() { return 'own trim'; } })),
  "Object.assign(['h i', ' '], { charCodeAt(i) { return 'list ' + i; }, toUpperCase() { return 'LIST'; }, substring(i) { return ' list ' + i; }, trim() { return 'list trim'; } })": () => (Object.assign(['h i', ' '], { charCodeAt(i) { return 'list ' + i; }, toUpperCase() { return 'LIST'; }, substring(i) { return ' list ' + i; }, trim() { return 'list trim'; } })),
  "{ 0: 'x', 1: ' ', length: 2, charCodeAt(i) { return 9; }, toUpperCase() { return 'OBJECT'; }, substring(i) { return ' object'; }, trim() { return 'object trim'; }, *[Symbol.iterator]() { yield 'yielded'; } }": () => ({ 0: 'x', 1: ' ', length: 2, charCodeAt(i) { return 9; }, toUpperCase() { return 'OBJECT'; }, substring(i) { return ' object'; }, trim() { return 'object trim'; }, *[Symbol.iterator]() { yield 'yielded'; } }),
  "{ get 0() { log.push('get 0'); return ' '; }, get length() { log.push('get length'); return 1; }, charCodeAt(i) { log.push('charCodeAt ' + i); return 104; }, toUpperCase() { log.push('toUpperCase'); return 'U'; }, substring() { log.push('substring'); return 's'; }, trim() { log.push('trim'); return 't'; }, [Symbol.iterator]() { log.push('iterator'); return [][Symbol.iterator](); } }": () => ({ get 0() { log.push('get 0'); return ' '; }, get length() { log.push('get length'); return 1; }, charCodeAt(i) { log.push('charCodeAt ' + i); return 104; }, toUpperCase() { log.push('toUpperCase'); return 'U'; }, substring() { log.push('substring'); return 's'; }, trim() { log.push('trim'); return 't'; }, [Symbol.iterator]() { log.push('iterator'); return [][Symbol.iterator](); } }),
  "Object.assign(Buffer.from(' \\t '), { charCodeAt(i) { return this[i]; }, toUpperCase() { return 'BYTES'; }, substring() { return ' bytes'; }, trim() { return 'bytes trim'; } })": () => (Object.assign(Buffer.from(' \t '), { charCodeAt(i) { return this[i]; }, toUpperCase() { return 'BYTES'; }, substring() { return ' bytes'; }, trim() { return 'bytes trim'; } })),
  "['hello', 'world']": () => (['hello', 'world']),
  "Buffer.from('hello world')": () => (Buffer.from('hello world')),
  "{ 0: 'h', length: 1 }": () => ({ 0: 'h', length: 1 }),
  "12": () => (12),
  "null": () => (null),
  "undefined": () => (undefined),
  "Symbol('x')": () => (Symbol('x')),
  "new Proxy(new String('a b'), { get(target, key, receiver) { log.push('get ' + String(key)); const found = Reflect.get(target, key, target); return typeof found === 'function' ? found.bind(target) : found; } })": () => (new Proxy(new String('a b'), { get(target, key, receiver) { log.push('get ' + String(key)); const found = Reflect.get(target, key, target); return typeof found === 'function' ? found.bind(target) : found; } })),
};

function make(text) {
  return made[text]();
}

function firstCodeAndCharacter(text) {
  return [text[0], text.charCodeAt(0)];
}

function capitalized(text) {
  return text[0].toUpperCase() + text.substring(1);
}

function countSpaces(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " || text.charCodeAt(i) === 9) count++;
  }
  return count;
}

function charactersAndCase(text) {
  const seen = [];
  for (const character of text) seen.push(character);
  return [seen, text.toUpperCase()];
}

function spreadAndTrim(text) {
  return [[...text].length, text.trim()];
}

const log = [];
globalThis.log = log;

const texts = [
  "'hello world'",
  "''",
  "new String('hello world')",
  "Object.assign(new String('hi'), { charCodeAt() { return 'own'; }, toUpperCase() { return 'OWN'; }, substring() { return ' own'; }, trim() { return 'own trim'; } })",
  "Object.assign(['h i', ' '], { charCodeAt(i) { return 'list ' + i; }, toUpperCase() { return 'LIST'; }, substring(i) { return ' list ' + i; }, trim() { return 'list trim'; } })",
  "{ 0: 'x', 1: ' ', length: 2, charCodeAt(i) { return 9; }, toUpperCase() { return 'OBJECT'; }, substring(i) { return ' object'; }, trim() { return 'object trim'; }, *[Symbol.iterator]() { yield 'yielded'; } }",
  "{ get 0() { log.push('get 0'); return ' '; }, get length() { log.push('get length'); return 1; }, charCodeAt(i) { log.push('charCodeAt ' + i); return 104; }, toUpperCase() { log.push('toUpperCase'); return 'U'; }, substring() { log.push('substring'); return 's'; }, trim() { log.push('trim'); return 't'; }, [Symbol.iterator]() { log.push('iterator'); return [][Symbol.iterator](); } }",
  "Object.assign(Buffer.from(' \\t '), { charCodeAt(i) { return this[i]; }, toUpperCase() { return 'BYTES'; }, substring() { return ' bytes'; }, trim() { return 'bytes trim'; } })",
  "['hello', 'world']",
  "Buffer.from('hello world')",
  "{ 0: 'h', length: 1 }",
  "12",
  "null",
  "undefined",
  "Symbol('x')",
  "new Proxy(new String('a b'), { get(target, key, receiver) { log.push('get ' + String(key)); const found = Reflect.get(target, key, target); return typeof found === 'function' ? found.bind(target) : found; } })",
];

const uses = [
  ["first code and character", firstCodeAndCharacter],
  ["capitalized", capitalized],
  ["spaces", countSpaces],
  ["characters and case", charactersAndCase],
  ["spread and trim", spreadAndTrim],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += firstCodeAndCharacter("hello")[1] + capitalized("hello").length + countSpaces("a b c") + charactersAndCase("ab")[0].length + spreadAndTrim(" ab ")[0];
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of texts) {
    attempt(name + " of " + text, () => use(make(text)));
    if (log.length) console.log("log", log.splice(0).join(", "));
  }
  attempt(name + " of a string again", () => use("hello world"));
}
