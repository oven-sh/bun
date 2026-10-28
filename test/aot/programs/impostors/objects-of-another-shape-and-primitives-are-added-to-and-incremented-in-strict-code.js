const log = [];

function make() {
  return {
    width: 3,
    height: 4,
    area() {
      return this.width * this.height;
    },
  };
}

function addToWidth(box) {
  return (box.width += 1);
}

function incrementWidth(box) {
  return box.width++;
}

function decrementWidthFirst(box) {
  return --box.width;
}

function giveWidthIfMissing(box) {
  return (box.width ??= 5);
}

const uses = [
  ["box.width += 1", box => addToWidth(box)],
  ["box.width++", box => incrementWidth(box)],
  ["--box.width", box => decrementWidthFirst(box)],
  ["box.width ??= 5", box => giveWidthIfMissing(box)],
];

const impostors = [
  ["a literal with the same names", `({ width: 3, height: 4, area() { return "its own area"; } })`],
  ["the same names in the other order", `({ height: 4, width: 3 })`],
  ["more names around them", `({ depth: 1, width: 3, color: "red", height: 4, weight: 9 })`],
  ["no width", `({ height: 4 })`],
  ["no names at all", `({})`],
  ["width on its prototype", `Object.assign(Object.create({ width: 30 }), { height: 4 })`],
  ["everything on its prototype", `Object.create({ width: 30, height: 40, area() { return "inherited area"; } })`],
  ["an honest one as its prototype", `Object.create(make())`],
  ["no prototype", `Object.assign(Object.create(null), { width: 3, height: 4 })`],
  ["another class with the same fields", `new (class Crate { constructor() { this.width = 3; this.height = 4; } area() { return "area of a crate"; } })()`],
  ["another class with the fields in the other order", `new (class Crate { height = 4; width = 3; })()`],
  ["a subclass with one more field", `new (class extends make().constructor { depth = 5; })(3, 4)`],
  ["a function with the names", `Object.assign(function () {}, { width: 3, height: 4 })`],
  ["an array with the names", `Object.assign([1, 2], { width: 3, height: 4 })`],
  ["a String object with the names", `Object.assign(new String("ab"), { width: 3, height: 4 })`],
  ["a Map with the names", `Object.assign(new Map(), { width: 3, height: 4 })`],
  ["numeric-looking and symbol names", `({ 1: "one", width: 3, 0: "zero", [Symbol.for("width")]: "symbol", height: 4 })`],
  ["parsed from JSON", `JSON.parse('{"width":3,"height":4}')`],
  ["parsed from JSON with a reviver", `JSON.parse('{"width":3,"height":4}', function (key, value) { return key === "width" ? "revived" : value; })`],
  ["a structured clone of an honest one", `structuredClone(make())`],
  ["a string", `"text"`],
  ["a number", `5`],
  ["a boolean", `true`],
  ["a bigint", `10n`],
  ["a symbol", `Symbol("s")`],
  ["null", `null`],
  ["undefined", `undefined`],
];

function conjure(text) {
  return (0, eval)("(function (make, log) { return " + text + "; })")(make, log);
}

function shorten(parts) {
  return parts.length > 12 ? parts.slice(0, 6).join(", ") + ", .. " + parts.length + " in all" : parts.join(", ");
}

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + shorten(value.map(show)) + "]";
  if (typeof value === "object" && value !== null) return "{" + shorten(Object.keys(value).map(key => key + ": " + show(value[key]))) + "}";
  return String(value);
}

function describe(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return show(value);
  try {
    const parts = Reflect.ownKeys(value).map(key => {
      const found = Reflect.getOwnPropertyDescriptor(value, key);
      const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
      return String(key) + " " + flags + " " + ("value" in found ? show(found.value) : "accessor");
    });
    return "{" + shorten(parts) + "}" + (Object.isExtensible(value) ? "" : " not extensible");
  } catch (error) {
    return "cannot be described: " + error.constructor.name;
  }
}

function report(phase, label, text) {
  for (const [name, use] of uses) {
    let line = phase + " | " + label + " | " + name + " -> ";
    let impostor;
    try {
      impostor = conjure(text);
    } catch (error) {
      console.log(line + "could not be made: " + error.constructor.name);
      continue;
    }
    log.length = 0;
    try {
      line += show(use(impostor));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    line += " | log " + log.splice(0).join(", ");
    line += " | now " + describe(impostor);
    log.length = 0;
    console.log(line);
  }
}

function showHonestResults() {
  return uses.map(([, use]) => show(use(make()))).join(" ; ");
}

console.log("strict code:", (function () { return this === undefined; })());
for (const [label, text] of impostors) report("before any honest call", label, text);
console.log("honest | " + showHonestResults());
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(make());
for (const [label, text] of impostors) {
  report("after 2000 honest calls", label, text);
  console.log("honest again | " + showHonestResults());
}

export {};
