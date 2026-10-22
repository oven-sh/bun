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

function store(list, key, value) {
  list[key] = value;
  return list.length;
}

function describe(list) {
  return "length " + list.length + " keys " + Reflect.ownKeys(list).map(key => (typeof key === "symbol" ? key.toString() : JSON.stringify(key))).join(" ");
}

function fill(list, keysToUse) {
  for (let i = 0; i < keysToUse.length; i++) list[keysToUse[i]] = i;
  return list;
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

for (let i = 0; i < 2000; i++) {
  const list = ["x"];
  store(list, 1, "y");
  store(list, 0, "z");
  fill([], [0, 1, 2]);
}

for (const key of keys) {
  attempt("list[" + key + "] = 'stored'", () => {
    const list = ["x", "y"];
    const length = store(list, make(key), "stored");
    return length + " | " + describe(list) + " | still a list: " + Array.isArray(list) + " " + (Object.getPrototypeOf(list) === Array.prototype);
  });
  if (log.length) console.log("log", log.splice(0).join(", "));
}

attempt("'length' as a key shortens", () => {
  const list = [1, 2, 3];
  store(list, "length", 1);
  return list;
});
attempt("'length' as a key with a text", () => {
  const list = [1, 2, 3];
  store(list, "length", "2");
  return list;
});
attempt("'length' as a key with a fraction", () => store([1, 2, 3], "length", 1.5));
attempt("'length' as a key with minus one", () => store([1, 2, 3], "length", -1));
attempt("'length' as a key with an object", () => {
  const order = [];
  const list = [1, 2, 3];
  store(list, "length", { valueOf() { order.push("valueOf"); return 1; } });
  return [list, order];
});
attempt("many kinds of keys in one loop", () => describe(fill([], [0, "1", 2.0, "03", -0, "-0", 1.5, null, [4], { toString: () => "5" }, "7"])));
attempt("a frozen list", () => store(Object.freeze(["x"]), "1", "y"));
attempt("a list whose length cannot change", () => store(Object.defineProperty(["x"], "length", { writable: false }), "1", "y"));
attempt("honest again", () => store(["x"], 1, "y"));
