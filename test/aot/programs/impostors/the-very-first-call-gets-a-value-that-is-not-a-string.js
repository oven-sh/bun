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

function hash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

function initials(text) {
  return text.split(" ").map(word => word[0]).join("");
}

function isBlank(text) {
  return text.trim() === "";
}

function quoted(text) {
  return '"' + text + '"';
}

function comesFirst(text) {
  return text < "m";
}

function lookUp(key) {
  return { a: "found a", 1: "found 1", null: "found null" }[key];
}

function vowels(text) {
  let count = 0;
  for (const character of text) if ("aeiou".includes(character)) count++;
  return count;
}

function ending(text) {
  return text.slice(-3);
}

attempt("hash of a look-alike", () => hash({ length: 2, charCodeAt: index => index + 1 }));
attempt("initials of a look-alike", () => initials({ split: () => [["first"], { 0: "second" }, "third"] }));
attempt("is blank of a look-alike", () => isBlank({ trim: () => new String("") }));
attempt("quoted number", () => quoted(-0));
attempt("comes first of a number", () => comesFirst(5));
attempt("look up by null", () => lookUp(null));
attempt("vowels of a list", () => vowels(["a", "ae", 1, "e"]));
attempt("ending of a list", () => ending([1, 2, 3, 4]));

attempt("hash of a text", () => hash("hello"));
attempt("initials of a text", () => initials("grace brewster hopper"));
attempt("is blank of a text", () => isBlank(" \n"));
attempt("quoted text", () => quoted("x"));
attempt("comes first of a text", () => comesFirst("5"));
attempt("look up by a text", () => lookUp("a"));
attempt("vowels of a text", () => vowels("education"));
attempt("ending of a text", () => ending("hello"));

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += hash("hello") + initials("a b").length + quoted("x").length + lookUp("a").length + vowels("education") + ending("hello").length;
  if (isBlank(" ")) total++;
  if (comesFirst("a")) total++;
}
console.log("2000 honest rounds", total);

attempt("hash of null", () => hash(null));
attempt("hash of a list of texts", () => hash(["a", "b"]));
attempt("hash of a wrapped text", () => hash(new String("hello")));
attempt("hash of bytes", () => hash(Buffer.from("hello")));
attempt("hash of a number", () => hash(12345));
attempt("initials of a list", () => initials(["a b"]));
attempt("is blank of a wrapped text", () => isBlank(new String("  ")));
attempt("quoted symbol", () => quoted(Symbol("s")));
attempt("quoted list", () => quoted([1, [2, 3]]));
attempt("comes first of undefined", () => comesFirst(undefined));
attempt("comes first of a list", () => comesFirst(["a"]));
attempt("look up by a number", () => lookUp(1));
attempt("look up by a list", () => lookUp(["a"]));
attempt("vowels of a set", () => vowels(new Set("aab")));
attempt("vowels of a number", () => vowels(5));
attempt("ending of bytes", () => ending(Buffer.from("hello")));
attempt("ending of a number", () => ending(12345));
