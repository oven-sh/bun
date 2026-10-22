function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

class Playlist {
  constructor(length, name, size) {
    this.length = length;
    this.name = name;
    this.size = size;
    this.description = "a playlist";
  }
  toFixed(digits) {
    return "playlist fixed to " + digits;
  }
  at(index) {
    return "track " + index;
  }
  slice(from) {
    return "tracks from " + from;
  }
  valueOf() {
    return this.length;
  }
  toString() {
    return "playlist " + this.name;
  }
}

function lengthOf(value) {
  return value.length;
}

function nameOf(value) {
  return value.name;
}

function sizeOf(value) {
  return value.size;
}

function descriptionOf(value) {
  return value.description;
}

function fixed(value) {
  return value.toFixed(1);
}

function first(value) {
  return value.at(0);
}

function rest(value) {
  return value.slice(1);
}

function asValue(value) {
  return value.valueOf();
}

function asText(value) {
  return value.toString();
}

function makerOf(value) {
  return value.constructor.name;
}

function setLength(value) {
  value.length = 1;
  return value.length;
}

function setName(value) {
  value.name = "renamed";
  return value.name;
}

function lengthFromPattern({ length }) {
  return length;
}

const uses = [
  [".length", lengthOf],
  [".name", nameOf],
  [".size", sizeOf],
  [".description", descriptionOf],
  [".toFixed(1)", fixed],
  [".at(0)", first],
  [".slice(1)", rest],
  [".valueOf()", asValue],
  [".toString()", value => (typeof value === "function" ? typeof asText(value) : asText(value))],
  [".constructor.name", makerOf],
  [".length = 1", setLength],
  [".name = ..", setName],
  ["{ length }", lengthFromPattern],
];

const values = [
  ["a string", () => "abc"],
  ["a number", () => 3.14159],
  ["-0", () => -0],
  ["a boolean", () => true],
  ["a bigint", () => 7n],
  ["a symbol with a description", () => Symbol("described")],
  ["null", () => null],
  ["undefined", () => undefined],
  ["an array", () => [1, 2, 3]],
  ["a frozen array", () => Object.freeze([1, 2, 3])],
  ["a function of two parameters", () => function two(a, b) {}],
  ["a class", () => class Named { static size = "static size"; }],
  ["arguments", () => (function () { return arguments; })(1, 2)],
  ["a typed array", () => new Uint8Array([1, 2, 3])],
  ["a Map", () => new Map([[1, 2]])],
  ["a Set", () => new Set([1, 2])],
  ["a String object", () => new String("abc")],
  ["a Number object", () => new Number(2.5)],
  ["an Error", () => new RangeError("out")],
  ["a regular expression", () => /x/g],
  ["a literal with the names", () => ({ length: "long", name: "literal", size: "big", description: "a literal" })],
  ["a string joined at run time", () => ["joi", "ned"].join("")],
  ["from JSON, a number", () => JSON.parse("12.5")],
];

function look(phase) {
  for (const [label, make] of values) {
    for (const [name, use] of uses) {
      let line = phase + " | " + label + " | " + name + " -> ";
      try {
        line += show(use(make()));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}

let count = 0;
for (let i = 0; i < 2000; i++) for (const [, use] of uses) if (use(new Playlist(i % 9, "mix", 3)) !== undefined) count++;
console.log("2000 honest playlists", count);
look("after 2000 playlists");
console.log("honest again", uses.map(([, use]) => show(use(new Playlist(2, "mix", 3)))).join(" "));
