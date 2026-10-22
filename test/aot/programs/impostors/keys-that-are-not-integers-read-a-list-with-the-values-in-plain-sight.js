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

const letters = ["zero", "one", "two"];

function readTheList(key) {
  return letters[key];
}

function read(list, key) {
  return list[key];
}

function isIn(list, key) {
  return key in list;
}

function hasOwn(list, key) {
  return Object.hasOwn(list, key);
}

function readInALoop(list, indexes) {
  const found = [];
  for (let i = 0; i < indexes.length; i++) found.push(list[indexes[i]]);
  return found;
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
for (let i = 0; i < 2000; i++) {
  total += readTheList(i % 3).length + read(letters, i % 3).length + readInALoop(letters, [0, 1, 2]).length;
  if (isIn(letters, i % 4)) total++;
  if (hasOwn(letters, i % 4)) total++;
}
console.log("2000 honest rounds", total);

function plain(found) {
  return typeof found === "function" ? "function " + found.name : found === Array.prototype ? "Array.prototype" : found;
}

const decorated = Object.assign(["zero", "one", "two"], { a: "own a", "-0": "own -0", "01": "own 01", "1.5": "own 1.5", "-1": "own -1", "1e3": "own 1e3", 4294967295: "own 4294967295", NaN: "own NaN", null: "own null", "": "own empty", [Symbol.for("a")]: "own symbol" });

for (const key of keys) {
  attempt("letters[" + key + "]", () => plain(readTheList(make(key))));
  attempt("list[" + key + "]", () => plain(read(letters, make(key))));
  attempt("decorated[" + key + "]", () => plain(read(decorated, make(key))));
  attempt(key + " in, own", () => [isIn(letters, make(key)), hasOwn(letters, make(key)), isIn(decorated, make(key)), hasOwn(decorated, make(key))].join(" "));
  if (log.length) console.log("log", log.splice(0).join(", "));
}
attempt("many kinds of keys in one loop", () => readInALoop(letters, [0, "1", 2.0, "2", "02", -0, "-0", 1.5, null, "length", [1], { toString: () => "2" }]));
attempt("honest again", () => [readTheList(1), read(letters, 2), isIn(letters, 2), isIn(letters, 3), hasOwn(letters, 0)]);
