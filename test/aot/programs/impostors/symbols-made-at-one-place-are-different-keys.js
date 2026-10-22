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

function makeKey() {
  return Symbol("key");
}

const KEY = Symbol("key");
const TAG = Symbol("key");

class Tagged {
  static TAG = TAG;
  [KEY] = "by the constant";
  [TAG] = "by the static member";
}

function makeHolder() {
  const secret = Symbol("secret");
  return {
    secret,
    store(object, value) {
      object[secret] = value;
      return object;
    },
    read(object) {
      return object[secret];
    },
    has(object) {
      return secret in object;
    },
  };
}

function read(object, key) {
  return object[key];
}

function countSymbols(object) {
  return Object.getOwnPropertySymbols(object).length;
}

for (let i = 0; i < 2000; i++) {
  const object = { [KEY]: 1 };
  read(object, KEY);
  object[makeKey()] = 2;
  countSymbols(object);
}

attempt("two symbols from one function", () => {
  const first = makeKey();
  const second = makeKey();
  const table = { [first]: "first", [second]: "second" };
  return [first === second, first == second, Object.is(first, second), table[first], table[second], countSymbols(table), first.description === second.description, first.toString() === second.toString()];
});
attempt("symbols from a loop", () => {
  const keys = [];
  const table = {};
  for (let i = 0; i < 5; i++) {
    const key = Symbol("in a loop");
    keys.push(key);
    table[key] = i;
  }
  return [countSymbols(table), keys.map(key => table[key]), new Set(keys).size, keys.indexOf(keys[3]), keys.includes(Symbol("in a loop"))];
});
attempt("the function's symbol is not the constant", () => {
  const table = { [KEY]: "constant" };
  return [read(table, KEY), read(table, makeKey()), read(table, Symbol("key")), read(table, "key"), read(table, "Symbol(key)"), makeKey() in table, KEY in table];
});
attempt("a class with two symbol members of one description", () => {
  const tagged = new Tagged();
  return [tagged[KEY], tagged[Tagged.TAG], KEY === Tagged.TAG, countSymbols(tagged), read(tagged, KEY), read(tagged, Tagged.TAG), read(tagged, makeKey())];
});
attempt("two holders keep their secrets apart", () => {
  const one = makeHolder();
  const two = makeHolder();
  const object = {};
  one.store(object, "of one");
  two.store(object, "of two");
  return [one.read(object), two.read(object), countSymbols(object), one.secret === two.secret, one.has({}), two.has(object), read(object, one.secret), read(object, two.secret)];
});
attempt("registered symbols are one key", () => {
  const table = { [Symbol.for("shared")]: "shared" };
  return [read(table, Symbol.for("shared")), read(table, make("Symbol.for('shared')")), read(table, Symbol.for("sha" + make("'red'"))), read(table, Symbol("shared")), Symbol.for("shared") === Symbol.for("shared"), Symbol.keyFor(Symbol.for("shared"))];
});
attempt("a symbol from eval with the description of the constant", () => read({ [KEY]: "constant" }, make("Symbol('key')")));
attempt("the constant handed to eval and back", () => {
  globalThis.keyForEval = KEY;
  const back = make("keyForEval");
  delete globalThis.keyForEval;
  return [back === KEY, read({ [KEY]: "constant" }, back), read(make("({ [Symbol('key')]: 'other' })"), KEY)];
});
attempt("a store by the constant from eval is seen", () => {
  globalThis.keyForEval = KEY;
  const object = make("({ [keyForEval]: 'stored by eval' })");
  delete globalThis.keyForEval;
  return [object[KEY], read(object, KEY), KEY in object, countSymbols(object)];
});
attempt("wrapped symbols are the same key", () => {
  const table = { [KEY]: "constant" };
  return [read(table, Object(KEY)), Object(KEY) === KEY, Object(KEY) == KEY, typeof Object(KEY), Object(KEY).description];
});
attempt("symbols as map keys", () => {
  const map = new Map([[makeKey(), 1], [makeKey(), 2], [KEY, 3]]);
  return [map.size, map.get(KEY), map.get(makeKey()), map.has(Symbol("key"))];
});
attempt("recursion makes a new symbol at each level", () => {
  const table = {};
  (function descend(level) {
    const key = Symbol("level");
    table[key] = level;
    if (level < 3) descend(level + 1);
    table[key] += 10;
  })(0);
  return Object.getOwnPropertySymbols(table).map(key => table[key]);
});
attempt("a generator makes a new symbol at each step", () => {
  function* keys() {
    while (true) yield Symbol("step");
  }
  const source = keys();
  const table = { [source.next().value]: 1, [source.next().value]: 2 };
  return countSymbols(table);
});
attempt("classes made in a function have their own symbols", () => {
  const build = () => {
    const mark = Symbol("mark");
    return class {
      static mark = mark;
      [mark] = "marked";
    };
  };
  const One = build();
  const Two = build();
  return [new One()[One.mark], new One()[Two.mark], new Two()[Two.mark], One.mark === Two.mark];
});
