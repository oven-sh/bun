// Members under computed symbol and numeric looking names.
const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Reflect.ownKeys(value).map(key => String(key) + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Shelf {
  constructor() {
    this.width = "field width";
    this.height = "field height";
  }
}

function OldShelf() {
  this.width = "field width";
  this.height = "field height";
}

function readKey(shelf, key) {
  return shelf[key];
}

function storeKey(shelf, key) {
  shelf[key] = "stored";
  return shelf;
}

function askKey(shelf, key) {
  return key in shelf;
}

function deleteKey(shelf, key) {
  return [delete shelf[key], Reflect.ownKeys(shelf).length];
}

function readThenReadByName(shelf, key) {
  return [shelf[key], shelf.width];
}

function storeThenReadByName(shelf, key) {
  shelf[key] = "stored";
  return shelf.width;
}

function literalWithKey(key) {
  return { width: "before", [key]: "computed", height: "after" };
}

function patternWithKey(shelf, key) {
  const { [key]: found = "default", ...others } = shelf;
  return [found, others];
}

const mark = Symbol("mark");
const keys = [
  ['"width"', () => "width"],
  ["joined to width", () => ["wid", "th"].join("")],
  ["from JSON", () => JSON.parse('"width"')],
  ["a String object", () => new String("width")],
  ["an array of one string", () => ["width"]],
  ["an object whose toString logs", () => ({ toString() { log.push("toString"); return "width"; } })],
  ["an object with Symbol.toPrimitive", () => ({ [Symbol.toPrimitive](hint) { log.push("toPrimitive " + hint); return "width"; } })],
  ["an object whose toString answers a symbol", () => ({ toString() { return mark; } })],
  ["a name nobody has", () => "depth"],
  ["an empty string", () => ""],
  ["a symbol", () => mark],
  ["a registered symbol", () => Symbol.for("width")],
  ["Symbol.iterator", () => Symbol.iterator],
  ["0", () => 0],
  ['"0"', () => "0"],
  ["-0", () => -0],
  ['"-0"', () => "-0"],
  ['"01"', () => "01"],
  ["1.5", () => 1.5],
  ["-1", () => -1],
  ["4294967294", () => 4294967294],
  ["4294967295", () => 4294967295],
  ["1e21", () => 1e21],
  ["NaN", () => NaN],
  ["5n", () => 5n],
  ["null", () => null],
  ["undefined", () => undefined],
  ['"__proto__"', () => "__proto__"],
  ['"constructor"', () => "constructor"],
  ['"hasOwnProperty"', () => "hasOwnProperty"],
];

const uses = [
  ["shelf[key]", (make, key) => readKey(make(), key)],
  ["shelf[key] = ..", (make, key) => storeKey(make(), key)],
  ["key in shelf", (make, key) => askKey(make(), key)],
  ["delete shelf[key]", (make, key) => deleteKey(make(), key)],
  ["shelf[key], shelf.width", (make, key) => readThenReadByName(make(), key)],
  ["shelf[key] = .., shelf.width", (make, key) => storeThenReadByName(make(), key)],
  ["{ width, [key], height }", (make, key) => literalWithKey(key)],
  ["{ [key]: found = .., ...others }", (make, key) => patternWithKey(make(), key)],
];

const kinds = [
  ["class", () => new Shelf()],
  ["constructor function", () => new OldShelf()],
];

for (let i = 0; i < 2000; i++) for (const [, make] of kinds) for (const [, use] of uses) use(make, i % 2 ? "width" : "height");

kinds.forEach(([kind, make], which) => {
  for (const [label, makeKey] of keys) {
    for (const [name, use] of uses) {
      if (which === 1 && name !== "shelf[key]" && name !== "shelf[key] = .., shelf.width") continue;
      let line = kind + " | " + label + " | " + name + " -> ";
      try {
        line += show(use(make, makeKey()));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
    }
  }
});
