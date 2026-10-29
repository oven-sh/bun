// Changed object literals are copied spread and turned into json.
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

function copyWithAssign(box) {
  return Object.assign({}, box);
}

function copyWithSpread(box) {
  return { ...box };
}

function copyWithSpreadBetweenMembers(box) {
  return { width: "before", ...box, height: "after" };
}

function turnIntoJson(box) {
  return JSON.stringify(box);
}

const uses = [
  ["Object.assign({}, box)", box => copyWithAssign(box)],
  ["{ ...box }", box => copyWithSpread(box)],
  ["{ width, ...box, height }", box => copyWithSpreadBetweenMembers(box)],
  ["JSON.stringify(box)", box => turnIntoJson(box)],
];

const impostors = [
  ["width deleted", `(box => (delete box.width, box))(make())`],
  ["width deleted and added again", `(box => (delete box.width, (box.width = 3), box))(make())`],
  ["height deleted", `(box => (delete box.height, box))(make())`],
  ["both deleted and added in the other order", `(box => (delete box.width, delete box.height, (box.height = 4), (box.width = 3), box))(make())`],
  ["width turned into a getter", `Object.defineProperty(make(), "width", { get() { log.push("get width"); return 33; }, enumerable: true, configurable: true })`],
  ["width turned into a pair", `Object.defineProperty(make(), "width", { get() { log.push("get width"); return 33; }, set(value) { log.push("set width " + String(value)); }, enumerable: true, configurable: true })`],
  ["width turned into a getter and back", `(box => (Object.defineProperty(box, "width", { get() { return 33; }, enumerable: true, configurable: true }), Object.defineProperty(box, "width", { value: 3, writable: true }), box))(make())`],
  ["width cannot be written", `Object.defineProperty(make(), "width", { writable: false })`],
  ["width is not enumerable", `Object.defineProperty(make(), "width", { enumerable: false })`],
  ["width cannot be configured", `Object.defineProperty(make(), "width", { configurable: false })`],
  ["frozen", `Object.freeze(make())`],
  ["sealed", `Object.seal(make())`],
  ["not extensible", `Object.preventExtensions(make())`],
  ["its prototype is null", `Object.setPrototypeOf(make(), null)`],
  ["its prototype is another object", `Object.setPrototypeOf(make(), { area() { return "area of the new prototype"; }, depth: "inherited depth" })`],
  ["width deleted, an accessor on a new prototype", `Object.setPrototypeOf((box => (delete box.width, box))(make()), { get width() { log.push("get width"); return 77; }, set width(value) { log.push("set width " + String(value)); } })`],
  ["one more member", `Object.assign(make(), { depth: 1 })`],
  ["seventy more members", `(box => { for (let i = 0; i < 70; i++) box["extra" + i] = i; return box; })(make())`],
  ["an index member", `Object.assign(make(), { 0: "zero" })`],
  ["a symbol member", `Object.assign(make(), { [Symbol.for("extra")]: 1 })`],
  ["its own area", `Object.assign(make(), { area() { return "its own area"; } })`],
  ["an area that is a number", `Object.assign(make(), { area: 5 })`],
  ["width holds a string", `Object.assign(make(), { width: "3" })`],
  ["width holds an object with valueOf", `Object.assign(make(), { width: { valueOf() { log.push("valueOf"); return 3; } } })`],
  ["width holds undefined", `Object.assign(make(), { width: undefined })`],
  ["width holds null", `Object.assign(make(), { width: null })`],
  ["width holds -0", `Object.assign(make(), { width: -0 })`],
  ["width holds NaN", `Object.assign(make(), { width: NaN })`],
  ["width holds 2 ** 31", `Object.assign(make(), { width: 2147483648 })`],
  ["width holds 1.5", `Object.assign(make(), { width: 1.5 })`],
  ["width holds a bigint", `Object.assign(make(), { width: 3n })`],
  ["width holds a symbol", `Object.assign(make(), { width: Symbol.for("w") })`],
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
