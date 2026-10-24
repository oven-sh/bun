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

function walk(text, separator) {
  const seen = [];
  for (const piece of text.split(separator)) seen.push(piece);
  return seen;
}

function variablesChange(text, separator) {
  const seen = [];
  for (const piece of text.split(separator)) {
    seen.push(piece);
    text = "x;y;z";
    separator = ";";
  }
  return [seen, text, separator];
}

function changedByACallback(holder, callback) {
  const seen = [];
  for (const piece of holder.text.split(holder.separator)) {
    seen.push(piece);
    callback(holder);
  }
  return seen;
}

function stopsEarly(text) {
  for (const piece of text.split(",")) {
    if (piece === "b") return "found b";
  }
  return "no b";
}

function nested(text) {
  const seen = [];
  for (const line of text.split(";")) {
    for (const word of line.split(",")) seen.push(word);
  }
  return seen;
}

function firstTwo(text) {
  const [first, second] = text.split(",");
  return [first, second];
}

function spreadPieces(text) {
  return [...text.split(",")];
}

function keptList(text) {
  const pieces = text.split(",");
  const seen = [];
  for (const piece of pieces) {
    seen.push(piece);
    if (pieces.length < 5) pieces.push(piece + "!");
  }
  return [seen, pieces.length];
}

function walkList(pieces) {
  const seen = [];
  for (const piece of pieces) seen.push(piece);
  return seen;
}

function all() {
  return [walk("a,b,c", ","), stopsEarly("a,b,c"), nested("a,b;c"), firstTwo("a,b,c"), spreadPieces("a,b"), keptList("a,b")];
}

for (let i = 0; i < 2000; i++) {
  all();
  variablesChange("a,b,c", ",");
  changedByACallback({ text: "a,b", separator: "," }, () => {});
}

attempt("as usual", all);
for (const text of ["a,b,c", "", ",", "a", "a,,b", "a,b;c,d", "b", "\u4e16,\ud83d\ude00", "a," + "b"]) {
  const label = JSON.stringify(text);
  attempt("walk " + label, () => walk(text, ","));
  attempt("stops early " + label, () => stopsEarly(text));
  attempt("nested " + label, () => nested(text));
  attempt("first two " + label, () => firstTwo(text));
  attempt("spread " + label, () => spreadPieces(text));
  attempt("kept list " + label, () => keptList(text));
  attempt("the variables change " + label, () => variablesChange(text, ","));
}
attempt("the variables change", () => variablesChange("a,b,c", ","));
attempt("the members change", () => changedByACallback({ text: "a,b,c", separator: "," }, holder => { holder.text = "x"; holder.separator = "y"; }));

attempt("the pieces are changed by a callback that holds the list", () => {
  const pieces = "a,b,c".split(",");
  const seen = [];
  for (const piece of pieces) {
    seen.push(piece);
    pieces[2] = 5;
  }
  return seen;
});
attempt("the list of pieces gets an iterator of its own", () => {
  const pieces = "a,b,c".split(",");
  pieces[Symbol.iterator] = function* () {
    yield "from its own iterator";
  };
  return [[...pieces], walkList(pieces)];
});
attempt("the list of pieces gets another prototype", () => {
  const pieces = Object.setPrototypeOf("a,b,c".split(","), { *[Symbol.iterator]() { yield "from the other prototype"; } });
  return walkList(pieces);
});
attempt("at the end", all);
