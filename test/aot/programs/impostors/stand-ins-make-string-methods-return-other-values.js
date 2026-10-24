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

function replacedLength(text, pattern) {
  return text.replace(pattern, "+").length;
}

function replacedUpper(text, pattern) {
  return text.replace(pattern, "+").toUpperCase();
}

function replacedLabel(text, pattern) {
  return "<" + text.replace(pattern, "+") + ">";
}

function replacedKind(text, pattern) {
  const result = text.replace(pattern, "+");
  return [typeof result, result === null, result === undefined];
}

function replacedEverywhereLength(text, pattern) {
  return text.replaceAll(pattern, "+").length;
}

function chained(text, pattern) {
  return text.replace(pattern, "+").replace("+", "-").trim();
}

function piecesCount(text, separator) {
  return text.split(separator).length;
}

function firstPieceUpper(text, separator) {
  return text.split(separator)[0].toUpperCase();
}

function piecesJoined(text, separator) {
  return text.split(separator).join("|");
}

function piecesWalked(text, separator) {
  const seen = [];
  for (const piece of text.split(separator)) seen.push(piece);
  return seen;
}

function positionPlusOne(text, pattern) {
  return text.search(pattern) + 1;
}

function positionIsFound(text, pattern) {
  return text.search(pattern) !== -1;
}

function slicedAtPosition(text, pattern) {
  return text.slice(text.search(pattern));
}

function matchFirst(text, pattern) {
  const found = text.match(pattern);
  return found ? found[0] : "nothing";
}

function matchesWalked(text, pattern) {
  const seen = [];
  for (const found of text.matchAll(pattern)) seen.push(found);
  return seen;
}

const uses = [
  [Symbol.replace, "replaced length", replacedLength],
  [Symbol.replace, "replaced upper", replacedUpper],
  [Symbol.replace, "replaced label", replacedLabel],
  [Symbol.replace, "replaced kind", replacedKind],
  [Symbol.replace, "replaced everywhere length", replacedEverywhereLength],
  [Symbol.replace, "chained", chained],
  [Symbol.split, "pieces count", piecesCount],
  [Symbol.split, "first piece upper", firstPieceUpper],
  [Symbol.split, "pieces joined", piecesJoined],
  [Symbol.split, "pieces walked", piecesWalked],
  [Symbol.search, "position plus one", positionPlusOne],
  [Symbol.search, "position is found", positionIsFound],
  [Symbol.search, "sliced at position", slicedAtPosition],
  [Symbol.match, "match first", matchFirst],
  [Symbol.matchAll, "matches walked", matchesWalked],
];

for (let i = 0; i < 2000; i++) {
  replacedLength("a-b", "-");
  replacedUpper("a-b", "-");
  replacedLabel("a-b", "-");
  replacedKind("a-b", "-");
  replacedEverywhereLength("a-b", "-");
  chained("a-b", "-");
  piecesCount("a-b", "-");
  firstPieceUpper("a-b", "-");
  piecesJoined("a-b", "-");
  piecesWalked("a-b", "-");
  positionPlusOne("a-b", "-");
  positionIsFound("a-b", "-");
  slicedAtPosition("a-b", "-");
  matchFirst("a-b", "-");
  matchesWalked("a-b", /-/g);
}

const answers = [
  ["a text", "text"],
  ["the empty text", ""],
  ["a number", 5],
  ["minus zero", -0],
  ["a fraction", 1.5],
  ["NaN", NaN],
  ["null", null],
  ["undefined", undefined],
  ["true", true],
  ["a BigInt", 5n],
  ["a symbol", Symbol("s")],
  ["a list", ["x", "y"]],
  ["an empty list", []],
  ["a list of numbers", [1, 2]],
  ["a wrapped text", new String("wrapped")],
  ["an object", { length: "a lie", 0: "zero" }],
  ["a set", new Set(["in a set"])],
  ["a text for a number", "1"],
];

for (const [symbol, name, use] of uses) {
  for (const [label, answer] of answers) {
    attempt(name + " when the stand-in answers " + label, () => use("a-b", { [symbol]: () => answer }));
  }
}

function textOf(value) {
  return value.toString().length;
}

function localeTextOf(value) {
  return value.toLocaleString().length;
}

function jsonOf(value) {
  return value.toJSON().length;
}

for (let i = 0; i < 2000; i++) {
  textOf("abc");
  textOf(123);
  localeTextOf("abc");
  jsonOf(new Date(0));
}

const list = [1, 2];
list.join = () => 5;
attempt("toString of a list whose join answers a number", () => [typeof list.toString(), textOf(list), String(list), list + "", `${list}`]);
attempt("toString that answers a number", () => textOf({ toString: () => 5 }));
attempt("toString that answers null", () => textOf({ toString: () => null }));
attempt("toString that answers a list", () => textOf({ toString: () => ["a", "b"] }));
attempt("toLocaleString goes through toString", () => [typeof { toString: () => 5 }.toLocaleString(), localeTextOf({ toString: () => 5 })]);
attempt("toLocaleString that ends in null", () => localeTextOf({ toString: () => null }));
attempt("toJSON that answers a number", () => jsonOf({ toJSON: () => 5 }));
attempt("toJSON of an invalid date", () => jsonOf(new Date(NaN)));
attempt("toJSON of a date whose toISOString answers a number", () => jsonOf(Object.assign(new Date(0), { toISOString: () => 5 })));
