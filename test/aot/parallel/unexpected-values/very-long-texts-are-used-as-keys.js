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

const LENGTH = 3000;

const builders = [
  ["repeat", () => "k".repeat(LENGTH)],
  ["two halves", () => "k".repeat(LENGTH / 2) + "k".repeat(LENGTH / 2)],
  ["many small pieces", () => {
    let text = "";
    for (let i = 0; i < LENGTH; i++) text += "k";
    return text;
  }],
  ["prepended pieces", () => {
    let text = "";
    for (let i = 0; i < LENGTH / 10; i++) text = "kkkkkkkkkk" + text;
    return text;
  }],
  ["a slice of a longer text", () => ("x" + "k".repeat(LENGTH) + "x").slice(1, -1)],
  ["a slice of a wide text", () => ("k".repeat(LENGTH) + "世").slice(0, LENGTH)],
  ["joined", () => new Array(LENGTH + 1).join("k")],
  ["a wrapped text", () => new String("k".repeat(LENGTH))],
  ["an object that converts", () => ({ toString: () => "k".repeat(LENGTH / 2) + "k".repeat(LENGTH / 2) })],
  ["one character shorter", () => "k".repeat(LENGTH / 2) + "k".repeat(LENGTH / 2 - 1)],
  ["one character longer", () => "k".repeat(LENGTH / 2) + "k".repeat(LENGTH / 2 + 1)],
  ["the last character differs", () => "k".repeat(LENGTH - 1) + "j"],
  ["the first character differs", () => "j" + "k".repeat(LENGTH - 1)],
  ["the middle character differs", () => "k".repeat(LENGTH / 2) + "j" + "k".repeat(LENGTH / 2 - 1)],
  ["a wide character at the end", () => "k".repeat(LENGTH - 1) + "世"],
];

function read(table, key) {
  return table[key];
}

function isIn(table, key) {
  return key in table;
}

function hasOwn(table, key) {
  return Object.hasOwn(table, key);
}

function store(table, key, value) {
  table[key] = value;
  return Object.keys(table).length;
}

function remove(table, key) {
  return delete table[key];
}

class Holder {
  short = "field";
}

const log = [];
const tables = [
  ["a plain table", () => ({ a: 1, ["k".repeat(LENGTH)]: "own" })],
  ["a table that inherits it", () => Object.create({ ["k".repeat(LENGTH)]: "inherited" })],
  ["a table that inherits it from far", () => Object.create(Object.create(Object.create({ ["k".repeat(LENGTH)]: "inherited from far" })))],
  ["a table with a getter", () => ({ get ["k".repeat(LENGTH)]() { return "from a getter"; } })],
  ["a table without a prototype", () => Object.assign(Object.create(null), { ["k".repeat(LENGTH)]: "own" })],
  ["a table without it", () => ({ a: 1 })],
  ["a table with many members", () => {
    const table = {};
    for (let i = 0; i < 200; i++) table["m" + i] = i;
    table["k".repeat(LENGTH)] = "among many";
    return table;
  }],
  ["a table that had members deleted", () => {
    const table = { a: 1, b: 2, ["k".repeat(LENGTH)]: "own" };
    delete table.a;
    return table;
  }],
  ["a class instance", () => Object.assign(new Holder(), { ["k".repeat(LENGTH)]: "added" })],
  ["a class instance without it", () => new Holder()],
  ["a list", () => Object.assign([1], { ["k".repeat(LENGTH)]: "on a list" })],
  ["a function", () => Object.assign(() => {}, { ["k".repeat(LENGTH)]: "on a function" })],
  ["a frozen table", () => Object.freeze({ ["k".repeat(LENGTH)]: "frozen" })],
  ["a Proxy", () => new Proxy({}, { get: (target, key) => "trapped " + key.length, has: (target, key) => key.length === LENGTH, getOwnPropertyDescriptor: () => undefined, set: (target, key) => (log.push("set " + key.length), true), deleteProperty: (target, key) => (log.push("delete " + key.length), true) })],
  ["a table behind a Proxy", () => Object.create(new Proxy({}, { get: (target, key) => "trapped " + String(key).length, has: () => true }))],
  ["a wrapped text", () => Object.assign(new String("s"), { ["k".repeat(LENGTH)]: "on a wrapped text" })],
  ["bytes", () => Object.assign(new Uint8Array(1), { ["k".repeat(LENGTH)]: "on bytes" })],
];

for (let i = 0; i < 2000; i++) {
  const table = { a: 1 };
  read(table, "a");
  isIn(table, "a");
  hasOwn(table, "a");
  store(table, "b", 2);
  remove(table, "b");
}

for (const [tableName, makeTable] of tables) {
  for (const [keyName, makeKey] of builders) {
    const parts = [];
    for (const use of [() => read(makeTable(), makeKey()), () => isIn(makeTable(), makeKey()), () => hasOwn(makeTable(), makeKey()), () => store(makeTable(), makeKey(), "stored"), () => remove(makeTable(), makeKey())]) {
      try {
        parts.push(show(use()));
      } catch (error) {
        parts.push("threw " + error.constructor.name);
      }
    }
    console.log(tableName + ", " + keyName + " -> " + parts.join(" "));
  }
}
console.log("the Proxy was asked to", log.length, "times:", [...new Set(log)].join(", "));

attempt("a map", () => {
  const map = new Map([["k".repeat(LENGTH), "found"]]);
  return builders.map(([, makeKey]) => map.get(makeKey()));
});
attempt("a set", () => new Set(builders.map(([, makeKey]) => makeKey())).size);
attempt("a literal", () => builders.map(([, makeKey]) => Object.keys({ [makeKey()]: 1 })[0].length));
attempt("one table for all", () => {
  const table = {};
  for (const [name, makeKey] of builders) table[makeKey()] = name;
  return Object.values(table);
});
