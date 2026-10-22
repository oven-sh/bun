const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

console.log("strict code:", (function () { return this === undefined; })());

function Lamp(watts, color) {
  this.watts = watts;
  this.color = color;
}
Lamp.prototype.bright = function () {
  return this.watts > 40;
};

class Torch {
  constructor(watts, color) {
    this.watts = watts;
    this.color = color;
  }
  bright() {
    return this.watts > 40;
  }
}

class Lantern {
  watts = 60;
  color = "field";
  bright() {
    return this.watts > 40;
  }
}

const shared = {};

function makeLiteral(watts, color) {
  return { __proto__: shared, watts, color };
}

function fillLiteral(watts, color) {
  const lamp = { __proto__: shared };
  lamp.watts = watts;
  lamp.color = color;
  return lamp;
}

const makers = [
  ["a constructor function", () => new Lamp(60, "white")],
  ["a class that stores in its constructor", () => new Torch(60, "white")],
  ["a class with fields", () => new Lantern()],
  ["a literal", () => makeLiteral(60, "white")],
  ["an empty literal that is stored to", () => fillLiteral(60, "white")],
  ["Object.assign into a literal", () => Object.assign({ __proto__: shared }, { watts: 60, color: "white" })],
  ["a spread", () => ({ __proto__: shared, ...{ watts: 60, color: "white" } })],
  ["Object.create with descriptors", () => Object.create(shared, { watts: { value: 60, writable: true, enumerable: true, configurable: true }, color: { value: "white", writable: true, enumerable: true, configurable: true } })],
];

function wattsOf(lamp) {
  return lamp.watts;
}

function look(phase) {
  for (const [label, make] of makers) {
    let line = phase + ", " + label + " -> ";
    try {
      const lamp = make();
      line += show(lamp) + " | owns watts " + Object.hasOwn(lamp, "watts") + " | watts " + show(wattsOf(lamp));
      if (lamp.bright) line += " | bright " + lamp.bright();
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + " | log " + log.splice(0).join(", "));
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) for (const [, make] of makers) sum += wattsOf(make());
console.log("2000 honest constructions each", sum);
look("untouched");

const pair = {
  get() {
    log.push("get watts");
    return "from the getter";
  },
  set(value) {
    log.push("set watts " + value);
  },
  configurable: true,
};

for (const [where, holder] of [
  ["Lamp.prototype", Lamp.prototype],
  ["Torch.prototype", Torch.prototype],
  ["Lantern.prototype", Lantern.prototype],
  ["the prototype that the literals share", shared],
]) {
  Object.defineProperty(holder, "watts", pair);
  look("a pair on " + where);
  Object.defineProperty(holder, "watts", { get: pair.get, set: undefined, configurable: true });
  look("only a getter on " + where);
  Object.defineProperty(holder, "watts", { value: "fixed", writable: false, configurable: true });
  look("a value that cannot be written on " + where);
  delete holder.watts;
  look("removed from " + where);
}
