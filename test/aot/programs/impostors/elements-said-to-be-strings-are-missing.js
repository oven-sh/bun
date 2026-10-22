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

function characterUpper(text, index) {
  return text[index].toUpperCase();
}

function characterKind(text, index) {
  const character = text[index];
  return [typeof character, character === undefined, character + "!"];
}

function atUpper(text, index) {
  return text.at(index).toUpperCase();
}

function charAtUpper(text, index) {
  return text.charAt(index).toUpperCase() + "|";
}

function codePointFixed(text, index) {
  return text.codePointAt(index).toString(16);
}

function codeFixed(text, index) {
  return text.charCodeAt(index).toString(16);
}

function elementLength(index) {
  const names = ["ada", "grace"];
  return names[index].length;
}

function poppedLength(count) {
  const names = ["ada", "grace"];
  let last;
  for (let i = 0; i < count; i++) last = names.pop();
  return last.length;
}

function shiftedUpper(count) {
  const names = ["ada", "grace"];
  let first;
  for (let i = 0; i < count; i++) first = names.shift();
  return first.toUpperCase();
}

function foundLength(letter) {
  return ["ada", "grace"].find(name => name.startsWith(letter)).length;
}

function foundLastLength(letter) {
  return ["ada", "grace"].findLast(name => name.startsWith(letter)).length;
}

function atLength(index) {
  return ["ada", "grace"].at(index).length;
}

function holeLength(index) {
  return ["ada", , "grace"][index].length;
}

function spreadCharacterUpper(text, index) {
  return [...text][index].toUpperCase();
}

function fromCharacterUpper(text, index) {
  return Array.from(text)[index].toUpperCase();
}

function destructuredUpper(text) {
  const [, second] = text;
  return second.toUpperCase();
}

function destructuredWithDefault(text) {
  const [, second = "default"] = text;
  return second.toUpperCase();
}

function lastOfSplit(text) {
  const pieces = text.split("/");
  return pieces[pieces.length].length;
}

function firstOfFiltered(text) {
  return text.split(" ").filter(word => word.length > 3)[0].length;
}

function entryName(object, index) {
  return Object.entries(object)[index][0].toUpperCase();
}

function longest(words) {
  let best;
  for (const word of words) if (best === undefined || word.length > best.length) best = word;
  return best.length;
}

function reduced(words) {
  return words.reduce((a, b) => (a.length >= b.length ? a : b)).length;
}

for (let i = 0; i < 2000; i++) {
  characterUpper("abc", i % 3);
  characterKind("abc", i % 3);
  atUpper("abc", i % 3);
  charAtUpper("abc", i % 3);
  codePointFixed("abc", i % 3);
  codeFixed("abc", i % 3);
  elementLength(i % 2);
  poppedLength(1 + (i % 2));
  shiftedUpper(1 + (i % 2));
  foundLength("a");
  foundLastLength("g");
  atLength(i % 2);
  holeLength(0);
  spreadCharacterUpper("abc", i % 3);
  fromCharacterUpper("abc", i % 3);
  destructuredUpper("abc");
  destructuredWithDefault("abc");
  firstOfFiltered("some words");
  entryName({ a: 1 }, 0);
  longest(["a", "bc"]);
  reduced(["a", "bc"]);
}

for (const index of [0, 2, 3, -1, 99, 1.5, NaN, "1", "x", undefined]) {
  const label = show(index);
  attempt("text[" + label + "].toUpperCase()", () => characterUpper("abc", index));
  attempt("kind of text[" + label + "]", () => characterKind("abc", index));
  attempt("text.at(" + label + ").toUpperCase()", () => atUpper("abc", index));
  attempt("text.charAt(" + label + ").toUpperCase()", () => charAtUpper("abc", index));
  attempt("text.codePointAt(" + label + ").toString(16)", () => codePointFixed("abc", index));
  attempt("text.charCodeAt(" + label + ").toString(16)", () => codeFixed("abc", index));
  attempt("names[" + label + "].length", () => elementLength(index));
  attempt("names.at(" + label + ").length", () => atLength(index));
  attempt("[...text][" + label + "].toUpperCase()", () => spreadCharacterUpper("abc", index));
  attempt("Array.from(text)[" + label + "].toUpperCase()", () => fromCharacterUpper("abc", index));
}
attempt("popped", () => [poppedLength(1), poppedLength(2)]);
attempt("popped once too often", () => poppedLength(3));
attempt("popped never", () => poppedLength(0));
attempt("shifted once too often", () => shiftedUpper(3));
attempt("found nothing", () => foundLength("z"));
attempt("found nothing from the end", () => foundLastLength("z"));
attempt("a hole", () => holeLength(1));
attempt("destructured from a short text", () => destructuredUpper("a"));
attempt("destructured from a short text with a default", () => destructuredWithDefault("a"));
attempt("destructured from the empty text", () => destructuredUpper(""));
attempt("one past the last piece", () => lastOfSplit("a/b"));
attempt("nothing passes the filter", () => firstOfFiltered("a b c"));
attempt("an entry past the end", () => entryName({ a: 1 }, 1));
attempt("the longest of none", () => longest([]));
attempt("reduce of none", () => reduced([]));
attempt("reduce of one", () => reduced(["only"]));
