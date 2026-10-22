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
  "'abc'": () => ('abc'),
  "'ab' + 'c'": () => ('ab' + 'c'),
  "'xabcx'.slice(1, 4)": () => ('xabcx'.slice(1, 4)),
  "['a', 'b', 'c'].join('')": () => (['a', 'b', 'c'].join('')),
  "'ABC'.toLowerCase()": () => ('ABC'.toLowerCase()),
  "String.fromCharCode(97, 98, 99)": () => (String.fromCharCode(97, 98, 99)),
  "'abc\\u4e16'.slice(0, 3)": () => ('abc\u4e16'.slice(0, 3)),
  "'abd'": () => ('abd'),
  "'ab'": () => ('ab'),
  "'abc '": () => ('abc '),
  "''": () => (''),
  "' '": () => (' '),
  "'1'": () => ('1'),
  "'1.0'": () => ('1.0'),
  "'01'": () => ('01'),
  "new String('abc')": () => (new String('abc')),
  "new String('')": () => (new String('')),
  "new String('1')": () => (new String('1')),
  "['abc']": () => (['abc']),
  "[['abc']]": () => ([['abc']]),
  "['a', 'b', 'c']": () => (['a', 'b', 'c']),
  "[]": () => ([]),
  "[[]]": () => ([[]]),
  "[1]": () => ([1]),
  "[null]": () => ([null]),
  "[undefined]": () => ([undefined]),
  "0": () => (0),
  "-0": () => (-0),
  "1": () => (1),
  "1n": () => (1n),
  "0n": () => (0n),
  "NaN": () => (NaN),
  "true": () => (true),
  "false": () => (false),
  "null": () => (null),
  "undefined": () => (undefined),
  "Symbol('abc')": () => (Symbol('abc')),
  "Symbol.for('abc')": () => (Symbol.for('abc')),
  "{}": () => ({}),
  "{ toString() { log.push('toString'); return 'abc'; } }": () => ({ toString() { log.push('toString'); return 'abc'; } }),
  "{ valueOf() { log.push('valueOf'); return 'abc'; }, toString() { log.push('toString'); return 'no'; } }": () => ({ valueOf() { log.push('valueOf'); return 'abc'; }, toString() { log.push('toString'); return 'no'; } }),
  "{ valueOf() { log.push('valueOf'); return 1; } }": () => ({ valueOf() { log.push('valueOf'); return 1; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'abc'; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return 'abc'; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return ''; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return ''; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }),
  "Buffer.from('abc')": () => (Buffer.from('abc')),
  "new Uint8Array([1])": () => (new Uint8Array([1])),
  "new Uint8Array(0)": () => (new Uint8Array(0)),
  "new Date(1)": () => (new Date(1)),
  "/abc/": () => (/abc/),
  "new Proxy(new String('abc'), {})": () => (new Proxy(new String('abc'), {})),
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'toString' ? () => 'abc' : undefined; } })": () => (new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'toString' ? () => 'abc' : undefined; } })),
};

function make(text) {
  return made[text]();
}

function isStrictlyAbc(value) {
  return value === "abc";
}

function isNotStrictlyAbc(value) {
  return value !== "abc";
}

function isLooselyAbc(value) {
  return value == "abc";
}

function isLooselyOne(value) {
  return value == "1";
}

function isLooselyEmpty(value) {
  return value == "";
}

function isStrictlyEmpty(value) {
  return value === "";
}

function literalOnTheLeft(value) {
  return "abc" == value;
}

const log = [];
globalThis.log = log;

const values = [
  "'abc'",
  "'ab' + 'c'",
  "'xabcx'.slice(1, 4)",
  "['a', 'b', 'c'].join('')",
  "'ABC'.toLowerCase()",
  "String.fromCharCode(97, 98, 99)",
  "'abc\\u4e16'.slice(0, 3)",
  "'abd'",
  "'ab'",
  "'abc '",
  "''",
  "' '",
  "'1'",
  "'1.0'",
  "'01'",
  "new String('abc')",
  "new String('')",
  "new String('1')",
  "['abc']",
  "[['abc']]",
  "['a', 'b', 'c']",
  "[]",
  "[[]]",
  "[1]",
  "[null]",
  "[undefined]",
  "0",
  "-0",
  "1",
  "1n",
  "0n",
  "NaN",
  "true",
  "false",
  "null",
  "undefined",
  "Symbol('abc')",
  "Symbol.for('abc')",
  "{}",
  "{ toString() { log.push('toString'); return 'abc'; } }",
  "{ valueOf() { log.push('valueOf'); return 'abc'; }, toString() { log.push('toString'); return 'no'; } }",
  "{ valueOf() { log.push('valueOf'); return 1; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'abc'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return ''; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }",
  "Buffer.from('abc')",
  "new Uint8Array([1])",
  "new Uint8Array(0)",
  "new Date(1)",
  "/abc/",
  "new Proxy(new String('abc'), {})",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'toString' ? () => 'abc' : undefined; } })",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  const honest = i % 2 ? "abc" : "abd";
  if (isStrictlyAbc(honest)) total++;
  if (isNotStrictlyAbc(honest)) total += 2;
  if (isLooselyAbc(honest)) total += 3;
  if (isLooselyOne(honest)) total += 5;
  if (isLooselyEmpty(honest)) total += 7;
  if (isStrictlyEmpty(honest)) total += 11;
  if (literalOnTheLeft(honest)) total += 13;
}
console.log("2000 honest rounds", total);

for (const text of values) {
  attempt(text, () => {
    const value = make(text);
    return [isStrictlyAbc(value), isNotStrictlyAbc(value), isLooselyAbc(value), isLooselyOne(value), isLooselyEmpty(value), isStrictlyEmpty(value), literalOnTheLeft(value)].join(" ");
  });
  if (log.length) console.log("log", log.splice(0).join(", "));
}
