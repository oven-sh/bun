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
  "'text'": () => ('text'),
  "''": () => (''),
  "new String('wrapped')": () => (new String('wrapped')),
  "Object.assign(new String('wrapped'), { toString() { log.push('own toString'); return 'by toString'; } })": () => (Object.assign(new String('wrapped'), { toString() { log.push('own toString'); return 'by toString'; } })),
  "Object.assign(new String('wrapped'), { valueOf() { log.push('own valueOf'); return 'by valueOf'; } })": () => (Object.assign(new String('wrapped'), { valueOf() { log.push('own valueOf'); return 'by valueOf'; } })),
  "Object.assign(new String('wrapped'), { [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return 'by toPrimitive'; } })": () => (Object.assign(new String('wrapped'), { [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return 'by toPrimitive'; } })),
  "Object.setPrototypeOf(new String('wrapped'), null)": () => (Object.setPrototypeOf(new String('wrapped'), null)),
  "Object.setPrototypeOf(new String('wrapped'), { toString() { log.push('inherited toString'); return 'other prototype'; } })": () => (Object.setPrototypeOf(new String('wrapped'), { toString() { log.push('inherited toString'); return 'other prototype'; } })),
  "0": () => (0),
  "-0": () => (-0),
  "1.50": () => (1.50),
  "1e21": () => (1e21),
  "1e-7": () => (1e-7),
  "123456789012345680000": () => (123456789012345680000),
  "0.1 + 0.2": () => (0.1 + 0.2),
  "NaN": () => (NaN),
  "-Infinity": () => (-Infinity),
  "10n": () => (10n),
  "true": () => (true),
  "null": () => (null),
  "undefined": () => (undefined),
  "Symbol('s')": () => (Symbol('s')),
  "[]": () => ([]),
  "[1, [2, [3]]]": () => ([1, [2, [3]]]),
  "[null, undefined, , '']": () => ([null, undefined, , '']),
  "[{}]": () => ([{}]),
  "{}": () => ({}),
  "Object.create(null)": () => (Object.create(null)),
  "{ toString() { log.push('toString'); return 'T'; }, valueOf() { log.push('valueOf'); return 'V'; } }": () => ({ toString() { log.push('toString'); return 'T'; }, valueOf() { log.push('valueOf'); return 'V'; } }),
  "{ toString() { log.push('toString'); return 7; }, valueOf() { log.push('valueOf'); return {}; } }": () => ({ toString() { log.push('toString'); return 7; }, valueOf() { log.push('valueOf'); return {}; } }),
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return -0; } }": () => ({ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return -0; } }),
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return {}; } }": () => ({ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return {}; } }),
  "{ toString: null, valueOf() { log.push('valueOf'); return null; } }": () => ({ toString: null, valueOf() { log.push('valueOf'); return null; } }),
  "{ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return hint; } }": () => ({ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return hint; } }),
  "{ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return Symbol('inner'); } }": () => ({ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return Symbol('inner'); } }),
  "{ [Symbol.toPrimitive]: undefined, toString() { log.push('toString'); return 'fallback'; } }": () => ({ [Symbol.toPrimitive]: undefined, toString() { log.push('toString'); return 'fallback'; } }),
  "{ [Symbol.toPrimitive]: 5 }": () => ({ [Symbol.toPrimitive]: 5 }),
  "{ get [Symbol.toPrimitive]() { log.push('get toPrimitive'); return undefined; }, get toString() { log.push('get toString'); return () => 'got'; }, get valueOf() { log.push('get valueOf'); return () => 'valued'; } }": () => ({ get [Symbol.toPrimitive]() { log.push('get toPrimitive'); return undefined; }, get toString() { log.push('get toString'); return () => 'got'; }, get valueOf() { log.push('get valueOf'); return () => 'valued'; } }),
  "{ toString() { throw new RangeError('no'); } }": () => ({ toString() { throw new RangeError('no'); } }),
  "new Date(0)": () => (new Date(0)),
  "new Date(NaN)": () => (new Date(NaN)),
  "Object.assign(new Date(0), { toString() { log.push('date toString'); return 'D'; }, valueOf() { log.push('date valueOf'); return 1; } })": () => (Object.assign(new Date(0), { toString() { log.push('date toString'); return 'D'; }, valueOf() { log.push('date valueOf'); return 1; } })),
  "new Number(-0)": () => (new Number(-0)),
  "new Boolean(false)": () => (new Boolean(false)),
  "Object(Symbol('boxed'))": () => (Object(Symbol('boxed'))),
  "Object(5n)": () => (Object(5n)),
  "/a+/gi": () => (/a+/gi),
  "new Error('message')": () => (new Error('message')),
  "new RangeError()": () => (new RangeError()),
  "Buffer.from('bytes')": () => (Buffer.from('bytes')),
  "new Uint8Array([1, 2])": () => (new Uint8Array([1, 2])),
  "new Map()": () => (new Map()),
  "Math": () => (Math),
  "JSON": () => (JSON),
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return undefined; } })": () => (new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return undefined; } })),
  "new Proxy(new String('wrapped'), {})": () => (new Proxy(new String('wrapped'), {})),
};

function make(text) {
  return made[text]();
}

function alone(value) {
  return `${value}`;
}

function inside(value) {
  return `<${value}>`;
}

function twice(value) {
  return `${value}, ${value}`;
}

function byString(value) {
  return String(value);
}

function byJoin(value) {
  return [value].join();
}

function byConcat(value) {
  return "".concat(value);
}

const log = [];
globalThis.log = log;

const values = [
  "'text'",
  "''",
  "new String('wrapped')",
  "Object.assign(new String('wrapped'), { toString() { log.push('own toString'); return 'by toString'; } })",
  "Object.assign(new String('wrapped'), { valueOf() { log.push('own valueOf'); return 'by valueOf'; } })",
  "Object.assign(new String('wrapped'), { [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return 'by toPrimitive'; } })",
  "Object.setPrototypeOf(new String('wrapped'), null)",
  "Object.setPrototypeOf(new String('wrapped'), { toString() { log.push('inherited toString'); return 'other prototype'; } })",
  "0",
  "-0",
  "1.50",
  "1e21",
  "1e-7",
  "123456789012345680000",
  "0.1 + 0.2",
  "NaN",
  "-Infinity",
  "10n",
  "true",
  "null",
  "undefined",
  "Symbol('s')",
  "[]",
  "[1, [2, [3]]]",
  "[null, undefined, , '']",
  "[{}]",
  "{}",
  "Object.create(null)",
  "{ toString() { log.push('toString'); return 'T'; }, valueOf() { log.push('valueOf'); return 'V'; } }",
  "{ toString() { log.push('toString'); return 7; }, valueOf() { log.push('valueOf'); return {}; } }",
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return -0; } }",
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return {}; } }",
  "{ toString: null, valueOf() { log.push('valueOf'); return null; } }",
  "{ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return hint; } }",
  "{ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return Symbol('inner'); } }",
  "{ [Symbol.toPrimitive]: undefined, toString() { log.push('toString'); return 'fallback'; } }",
  "{ [Symbol.toPrimitive]: 5 }",
  "{ get [Symbol.toPrimitive]() { log.push('get toPrimitive'); return undefined; }, get toString() { log.push('get toString'); return () => 'got'; }, get valueOf() { log.push('get valueOf'); return () => 'valued'; } }",
  "{ toString() { throw new RangeError('no'); } }",
  "new Date(0)",
  "new Date(NaN)",
  "Object.assign(new Date(0), { toString() { log.push('date toString'); return 'D'; }, valueOf() { log.push('date valueOf'); return 1; } })",
  "new Number(-0)",
  "new Boolean(false)",
  "Object(Symbol('boxed'))",
  "Object(5n)",
  "/a+/gi",
  "new Error('message')",
  "new RangeError()",
  "Buffer.from('bytes')",
  "new Uint8Array([1, 2])",
  "new Map()",
  "Math",
  "JSON",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return undefined; } })",
  "new Proxy(new String('wrapped'), {})",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += alone("a").length + inside("a").length + twice("a").length + byString("a").length + byJoin("a").length + byConcat("a").length;
}
console.log("2000 honest rounds", total);

for (const text of values) {
  attempt("`${" + text + "}`", () => alone(make(text)));
  attempt("`<${" + text + "}>`", () => inside(make(text)));
  attempt("twice " + text, () => twice(make(text)));
  if (log.length) console.log("log of the templates", log.splice(0).join(", "));
  attempt("String(" + text + ")", () => byString(make(text)));
  attempt("[" + text + "].join()", () => byJoin(make(text)));
  attempt("''.concat(" + text + ")", () => byConcat(make(text)));
  if (log.length) console.log("log of the calls", log.splice(0).join(", "));
}
attempt("honest again", () => [alone("a"), inside("a"), twice("a"), byString("a"), byJoin("a"), byConcat("a")]);
