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
  "'12'": () => ('12'),
  "12": () => (12),
  "12.75": () => (12.75),
  "-0": () => (-0),
  "1e21": () => (1e21),
  "1e-7": () => (1e-7),
  "0.000001": () => (0.000001),
  "NaN": () => (NaN),
  "Infinity": () => (Infinity),
  "12n": () => (12n),
  "true": () => (true),
  "null": () => (null),
  "undefined": () => (undefined),
  "''": () => (''),
  "' 12 '": () => (' 12 '),
  "'0x1f'": () => ('0x1f'),
  "'12px'": () => ('12px'),
  "'\\ud83d'": () => ('\ud83d'),
  "'%'": () => ('%'),
  "new String('12')": () => (new String('12')),
  "new Number(12)": () => (new Number(12)),
  "[12]": () => ([12]),
  "[1, 2]": () => ([1, 2]),
  "[]": () => ([]),
  "{}": () => ({}),
  "{ toString() { log.push('toString'); return '12'; }, valueOf() { log.push('valueOf'); return 34; } }": () => ({ toString() { log.push('toString'); return '12'; }, valueOf() { log.push('valueOf'); return 34; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return '12'; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return '12'; } }),
  "Symbol('12')": () => (Symbol('12')),
  "Buffer.from('12')": () => (Buffer.from('12')),
  "new Uint8Array([1, 2])": () => (new Uint8Array([1, 2])),
  "/12/g": () => (/12/g),
};

function make(text) {
  return made[text]();
}

function toInteger(text) {
  return parseInt(text);
}

function toIntegerBaseSixteen(text) {
  return parseInt(text, 16);
}

function toFloat(text) {
  return parseFloat(text);
}

function encoded(text) {
  return encodeURIComponent(text);
}

function decoded(text) {
  return decodeURIComponent(text);
}

function parsed(text) {
  return JSON.parse(text);
}

function pattern(text) {
  return new RegExp(text).source;
}

function tested(text) {
  return /^[a-z0-9,]+$/.test(text);
}

function executed(text) {
  const found = /(\d+)/.exec(text);
  return found && [found[0], found.index, typeof found.input];
}

function message(text) {
  return new Error(text).message;
}

function described(text) {
  return Symbol(text).description;
}

function registered(text) {
  return Symbol.for(text) === Symbol.for(String(text));
}

function bigInteger(text) {
  return BigInt(text);
}

function byteLength(text) {
  return Buffer.byteLength(text);
}

function bytes(text) {
  return Buffer.from(text).length;
}

function encodedBytes(text) {
  return new TextEncoder().encode(text).length;
}

const uses = [
  ["parseInt", toInteger],
  ["parseInt 16", toIntegerBaseSixteen],
  ["parseFloat", toFloat],
  ["encodeURIComponent", encoded],
  ["decodeURIComponent", decoded],
  ["JSON.parse", parsed],
  ["new RegExp", pattern],
  ["test", tested],
  ["exec", executed],
  ["new Error", message],
  ["Symbol", described],
  ["Symbol.for", registered],
  ["BigInt", bigInteger],
  ["Buffer.byteLength", byteLength],
  ["Buffer.from", bytes],
  ["TextEncoder", encodedBytes],
];

const log = [];
globalThis.log = log;

const values = [
  "'12'",
  "12",
  "12.75",
  "-0",
  "1e21",
  "1e-7",
  "0.000001",
  "NaN",
  "Infinity",
  "12n",
  "true",
  "null",
  "undefined",
  "''",
  "' 12 '",
  "'0x1f'",
  "'12px'",
  "'\\ud83d'",
  "'%'",
  "new String('12')",
  "new Number(12)",
  "[12]",
  "[1, 2]",
  "[]",
  "{}",
  "{ toString() { log.push('toString'); return '12'; }, valueOf() { log.push('valueOf'); return 34; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return '12'; } }",
  "Symbol('12')",
  "Buffer.from('12')",
  "new Uint8Array([1, 2])",
  "/12/g",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("12")).length;
}
console.log("2000 honest rounds", total);

function outcome(use, text) {
  try {
    return show(use(make(text)));
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const text of values) {
  for (let from = 0; from < uses.length; from += 3) {
    console.log(text + " -> " + uses.slice(from, from + 3).map(([name, use]) => name + " " + outcome(use, text)).join("; "));
  }
  if (log.length) console.log("log", log.splice(0).join(", "));
}
