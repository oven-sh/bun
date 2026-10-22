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

function camelCase(text) {
  return text.replace(/[-_\s]+(.)?/g, function (match, character) {
    return character ? character.toUpperCase() : "";
  });
}

function kebabCase(text) {
  var result = "";
  for (var i = 0; i < text.length; i++) {
    var character = text[i];
    var lower = character.toLowerCase();
    if (character !== lower && i > 0) result += "-";
    result += lower;
  }
  return result;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function titleCase(text) {
  return text.split(" ").map(capitalize).join(" ");
}

function leftPad(text, width, filler) {
  text = text + "";
  filler = filler === undefined ? " " : filler + "";
  while (text.length < width && filler.length > 0) text = filler + text;
  return text;
}

function truncate(text, width) {
  if (text.length <= width) return text;
  return text.slice(0, width - 1) + "…";
}

function baseName(path) {
  var end = path.length;
  while (end > 1 && path[end - 1] === "/") end--;
  var start = path.lastIndexOf("/", end - 1) + 1;
  return path.slice(start, end);
}

function extension(path) {
  var name = baseName(path);
  var dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

function isUpperCase(text) {
  return text === text.toUpperCase() && text !== text.toLowerCase();
}

function compareVersions(a, b) {
  var left = a.split(".");
  var right = b.split(".");
  for (var i = 0; i < Math.max(left.length, right.length); i++) {
    var difference = (left[i] | 0) - (right[i] | 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

var uses = [
  ["camelCase", camelCase],
  ["kebabCase", kebabCase],
  ["capitalize", capitalize],
  ["titleCase", titleCase],
  ["leftPad", function (value) { return leftPad(value, 8, "."); }],
  ["leftPad with the value as filler", function (value) { return leftPad("x", 4, value); }],
  ["leftPad with the value as width", function (value) { return leftPad("x", value, "."); }],
  ["truncate", function (value) { return truncate(value, 4); }],
  ["baseName", baseName],
  ["extension", extension],
  ["isUpperCase", isUpperCase],
  ["compareVersions", function (value) { return compareVersions(value, "1.2.3"); }],
];

var values = [
  "'hello-big_world now'",
  "'helloBigWorld'",
  "'/usr/local/lib/file.tar.gz'",
  "'dir/'",
  "'1.10.0'",
  "'ABC'",
  "''",
  "'\\u00e9cole-\\u00fcber \\u0130\\u00df'",
  "'a' + '-b'",
  "new String('hello-world')",
  "['hello', 'World']",
  "['a/b', '/', 'c.d']",
  "[1, 2, 3]",
  "{ length: 2, 0: 'A', 1: 'b' }",
  "{ replace() { return 5; }, charAt() { return 'x'; }, slice() { return 'Y'; }, split() { return ['p', 'q']; }, lastIndexOf() { return 0; }, toUpperCase() { return this; }, toLowerCase() { return null; }, length: 9, toString() { return 'look'; } }",
  "Buffer.from('a/b.c')",
  "5",
  "3",
  "'3'",
  "1.5",
  "null",
  "undefined",
  "Symbol('s')",
];

var total = 0;
for (var i = 0; i < 2000; i++) {
  for (var j = 0; j < uses.length; j++) {
    if (j !== 6) total += String(uses[j][1]("hello-World/a.b")).length;
  }
  total += leftPad("x", 3, ".").length;
}
console.log("2000 honest rounds", total);

uses.forEach(function (use) {
  values.forEach(function (text) {
    attempt(use[0] + " " + text, function () {
      var given = make(text);
      var result = use[1](given);
      return result === given && typeof given === "object" && given !== null ? "the same object" : result;
    });
  });
});

console.log("bytes made in plain sight", Buffer.from("he").length);
