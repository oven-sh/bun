const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{..}";
  return String(value);
}

function describe(value) {
  return Reflect.ownKeys(value)
    .map(key => {
      const found = Reflect.getOwnPropertyDescriptor(value, key);
      const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
      return String(key) + " " + flags + " " + ("value" in found ? show(found.value) : (found.get ? "get" : "") + (found.set ? "set" : ""));
    })
    .join("; ");
}

function widthOf(box) {
  return box.width;
}

function heightOf(box) {
  return box.height;
}

function honest(width, height) {
  return { width, height };
}

const forms = [
  ["a name twice", (key, other) => ({ width: 1, height: 2, width: 3 })],
  ["a value, then a getter of the same name", (key, other) => ({ width: 1, height: 2, get width() { return "getter"; } })],
  ["a getter, then a value of the same name", (key, other) => ({ get width() { return "getter"; }, height: 2, width: 3 })],
  ["a getter and a setter apart", (key, other) => ({ get width() { return "getter"; }, height: 2, set width(value) {} })],
  ["a getter, a value, a setter", (key, other) => ({ get width() { return "getter"; }, width: 1, set width(value) {}, height: 2 })],
  ["a computed key that is width", (key, other) => ({ width: 1, height: 2, [key]: "computed" })],
  ["a computed key that is width, first", (key, other) => ({ [key]: "computed", width: 1, height: 2 })],
  ["a computed getter over a value", (key, other) => ({ width: 1, height: 2, get [key]() { return "computed getter"; } })],
  ["a spread that overrides", (key, other) => ({ width: 1, height: 2, ...other })],
  ["a spread that is overridden", (key, other) => ({ ...other, width: 1, height: 2 })],
  ["a spread in the middle", (key, other) => ({ width: 1, ...other, height: 2 })],
  ["a spread of a getter", (key, other) => ({ width: 1, height: 2, ...{ get width() { log.push("get width"); return "flattened"; } } })],
  ["a spread over a setter", (key, other) => ({ set width(value) { log.push("set width"); }, height: 2, ...other })],
  ["a spread of null and undefined", (key, other) => ({ width: 1, ...null, ...undefined, height: 2 })],
  ["a spread of a string", (key, other) => ({ width: 1, ..."ab", height: 2 })],
  ["a spread of an array", (key, other) => ({ width: 1, ...["x", "y"], height: 2 })],
  ["a spread of a number", (key, other) => ({ width: 1, ...5, height: 2 })],
  ["numeric-looking names between", (key, other) => ({ width: 1, 2: "two", height: 2, 1: "one", "-1": "minus one", "01": "zero one" })],
  ["a symbol between", (key, other) => ({ width: 1, [Symbol.for("between")]: "symbol", height: 2 })],
  ["a method named width", (key, other) => ({ width() { return "method"; }, height: 2 })],
  ["undefined values", (key, other) => ({ width: undefined, height: void 0 })],
  ["a conditional spread that adds nothing", (key, other) => ({ width: 1, ...(key === "no" && { height: 2 }) })],
  ["a conditional spread that adds height", (key, other) => ({ width: 1, ...(key === "width" && { height: 2 }) })],
  ["values evaluated in order", (key, other) => ({ width: (log.push("width"), 1), [(log.push("key"), "depth")]: (log.push("depth"), 2), height: (log.push("height"), 3) })],
  ["a value that throws halfway", (key, other) => ({ width: 1, height: (() => { throw new RangeError("halfway"); })(), depth: log.push("never") })],
  ["Object.assign over a literal", (key, other) => Object.assign({ width: 1, height: 2 }, other)],
  ["Object.fromEntries", (key, other) => Object.fromEntries([["height", 2], [key, 1], ["height", 3]])],
  ["the honest factory with holes in its arguments", (key, other) => honest()],
];

for (let i = 0; i < 2000; i++) {
  const box = honest(i % 5, 2);
  widthOf(box);
  heightOf(box);
}

for (let round = 0; round < 2; round++) {
  for (const [label, make] of forms) {
    let line = "round " + round + " | " + label + " -> ";
    try {
      const box = make(["wid", "th"].join(""), JSON.parse('{"height":"other height","width":"other width","depth":"other depth"}'));
      line += describe(box) + " | width " + show(widthOf(box)) + " | height " + show(heightOf(box)) + " | json " + JSON.stringify(box);
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
  }
  console.log("honest again", describe(honest(1, 2)), widthOf(honest(1, 2)), heightOf(honest(1, 2)));
}

const base = { greet() { return "base"; } };
const other = { greet() { return "other"; } };
const child = {
  __proto__: base,
  greet() {
    return "child, then " + super.greet();
  },
};
function greet(thing) {
  return thing.greet();
}
for (let i = 0; i < 2000; i++) greet(child);
console.log("super in a literal's method", greet(child));
Object.setPrototypeOf(child, other);
console.log("after the literal moved under another prototype", greet(child));
const borrower = { __proto__: base, greet: child.greet };
console.log("the method borrowed by another literal still uses its home", greet(borrower));
Object.setPrototypeOf(child, null);
try {
  console.log("after the home lost its prototype", greet(borrower));
} catch (error) {
  console.log("after the home lost its prototype threw", error.constructor.name);
}
