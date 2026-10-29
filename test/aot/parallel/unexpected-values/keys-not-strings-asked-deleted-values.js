// Keys that are not strings are asked for and deleted with the values in plain sight.
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
  "'a'": () => ('a'),
  "'a' + ''": () => ('a' + ''),
  "'xa'.slice(1)": () => ('xa'.slice(1)),
  "0": () => (0),
  "'0'": () => ('0'),
  "-0": () => (-0),
  "'-0'": () => ('-0'),
  "'00'": () => ('00'),
  "'0.0'": () => ('0.0'),
  "1": () => (1),
  "'1'": () => ('1'),
  "1.0": () => (1.0),
  "'1.0'": () => ('1.0'),
  "'01'": () => ('01'),
  "' 1'": () => (' 1'),
  "'+1'": () => ('+1'),
  "1e3": () => (1e3),
  "'1e3'": () => ('1e3'),
  "'1000'": () => ('1000'),
  "2": () => (2),
  "5": () => (5),
  "-1": () => (-1),
  "'-1'": () => ('-1'),
  "1.5": () => (1.5),
  "'1.5'": () => ('1.5'),
  "0.1 + 0.2": () => (0.1 + 0.2),
  "2147483647": () => (2147483647),
  "2147483648": () => (2147483648),
  "4294967294": () => (4294967294),
  "'4294967294'": () => ('4294967294'),
  "4294967295": () => (4294967295),
  "'4294967295'": () => ('4294967295'),
  "4294967296": () => (4294967296),
  "9007199254740993": () => (9007199254740993),
  "1e21": () => (1e21),
  "'1e21'": () => ('1e21'),
  "'1e+21'": () => ('1e+21'),
  "1e-7": () => (1e-7),
  "'1e-7'": () => ('1e-7'),
  "NaN": () => (NaN),
  "'NaN'": () => ('NaN'),
  "Infinity": () => (Infinity),
  "'Infinity'": () => ('Infinity'),
  "-Infinity": () => (-Infinity),
  "null": () => (null),
  "'null'": () => ('null'),
  "undefined": () => (undefined),
  "'undefined'": () => ('undefined'),
  "true": () => (true),
  "false": () => (false),
  "''": () => (''),
  "1n": () => (1n),
  "-1n": () => (-1n),
  "[]": () => ([]),
  "[1]": () => ([1]),
  "['a']": () => (['a']),
  "[1, 2]": () => ([1, 2]),
  "[[]]": () => ([[]]),
  "{}": () => ({}),
  "new String('a')": () => (new String('a')),
  "new String('1')": () => (new String('1')),
  "new Number(1)": () => (new Number(1)),
  "Symbol.for('a')": () => (Symbol.for('a')),
  "Symbol('a')": () => (Symbol('a')),
  "'Symbol(a)'": () => ('Symbol(a)'),
  "Object(Symbol.for('a'))": () => (Object(Symbol.for('a'))),
  "'length'": () => ('length'),
  "'constructor'": () => ('constructor'),
  "'__proto__'": () => ('__proto__'),
  "'prototype'": () => ('prototype'),
  "'toString'": () => ('toString'),
  "'hasOwnProperty'": () => ('hasOwnProperty'),
  "{ toString() { log.push('toString'); return 'a'; }, valueOf() { log.push('valueOf'); return 'b'; } }": () => ({ toString() { log.push('toString'); return 'a'; }, valueOf() { log.push('valueOf'); return 'b'; } }),
  "{ toString() { log.push('toString'); return 1; } }": () => ({ toString() { log.push('toString'); return 1; } }),
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return 1; } }": () => ({ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return 1; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'a'; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return 'a'; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return Symbol.for('a'); } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return Symbol.for('a'); } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }),
  "{ toString() { throw new RangeError('no'); } }": () => ({ toString() { throw new RangeError('no'); } }),
  "Object.create(null)": () => (Object.create(null)),
};

function make(text) {
  return made[text]();
}

function makeTable() {
  return { a: 1, 0: 2, 1: 3, "-0": 4, "1.5": 5, 1000: 6, "1e3": 7, null: 8, undefined: 9, NaN: 10, "": 11, "1,2": 12, true: 13, "[object Object]": 14, [Symbol.for("a")]: 15, length: 16 };
}

function isIn(table, key) {
  return key in table;
}

function hasOwn(table, key) {
  return Object.hasOwn(table, key);
}

function hasOwnTheOldWay(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function hasOwnAsAMethod(table, key) {
  return table.hasOwnProperty(key);
}

function isEnumerable(table, key) {
  return table.propertyIsEnumerable(key);
}

function remove(table, key) {
  return delete table[key];
}

function describe(table, key) {
  const found = Object.getOwnPropertyDescriptor(table, key);
  return found === undefined ? "none" : found.value;
}

const log = [];
globalThis.log = log;

const keys = [
  "'a'",
  "'a' + ''",
  "'xa'.slice(1)",
  "0",
  "'0'",
  "-0",
  "'-0'",
  "'00'",
  "'0.0'",
  "1",
  "'1'",
  "1.0",
  "'1.0'",
  "'01'",
  "' 1'",
  "'+1'",
  "1e3",
  "'1e3'",
  "'1000'",
  "2",
  "5",
  "-1",
  "'-1'",
  "1.5",
  "'1.5'",
  "0.1 + 0.2",
  "2147483647",
  "2147483648",
  "4294967294",
  "'4294967294'",
  "4294967295",
  "'4294967295'",
  "4294967296",
  "9007199254740993",
  "1e21",
  "'1e21'",
  "'1e+21'",
  "1e-7",
  "'1e-7'",
  "NaN",
  "'NaN'",
  "Infinity",
  "'Infinity'",
  "-Infinity",
  "null",
  "'null'",
  "undefined",
  "'undefined'",
  "true",
  "false",
  "''",
  "1n",
  "-1n",
  "[]",
  "[1]",
  "['a']",
  "[1, 2]",
  "[[]]",
  "{}",
  "new String('a')",
  "new String('1')",
  "new Number(1)",
  "Symbol.for('a')",
  "Symbol('a')",
  "'Symbol(a)'",
  "Object(Symbol.for('a'))",
  "'length'",
  "'constructor'",
  "'__proto__'",
  "'prototype'",
  "'toString'",
  "'hasOwnProperty'",
  "{ toString() { log.push('toString'); return 'a'; }, valueOf() { log.push('valueOf'); return 'b'; } }",
  "{ toString() { log.push('toString'); return 1; } }",
  "{ toString() { log.push('toString'); return {}; }, valueOf() { log.push('valueOf'); return 1; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'a'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return Symbol.for('a'); } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } }",
  "{ toString() { throw new RangeError('no'); } }",
  "Object.create(null)",
];

let total = 0;
const honestTable = makeTable();
for (let i = 0; i < 2000; i++) {
  const key = i % 2 ? "a" : "b";
  if (isIn(honestTable, key)) total++;
  if (hasOwn(honestTable, key)) total++;
  if (hasOwnTheOldWay(honestTable, key)) total++;
  if (hasOwnAsAMethod(honestTable, key)) total++;
  if (isEnumerable(honestTable, key)) total++;
  if (remove({ a: 1 }, key)) total++;
  total += String(describe(honestTable, key)).length;
}
console.log("2000 honest rounds", total);

for (const key of keys) {
  attempt(key, () => {
    const table = makeTable();
    return [isIn(table, make(key)), hasOwn(table, make(key)), hasOwnTheOldWay(table, make(key)), hasOwnAsAMethod(table, make(key)), isEnumerable(table, make(key)), describe(table, make(key))].join(" ");
  });
  if (log.length) console.log("log", log.splice(0).join(", "));
  attempt("delete " + key, () => {
    const table = makeTable();
    const before = Reflect.ownKeys(table).length;
    const answer = remove(table, make(key));
    return answer + " " + (before - Reflect.ownKeys(table).length);
  });
  if (log.length) console.log("log of delete", log.splice(0).join(", "));
}
