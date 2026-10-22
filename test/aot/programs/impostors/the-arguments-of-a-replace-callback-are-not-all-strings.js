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

function describeArguments(...given) {
  return "<" + given.map(value => (typeof value === "object" && value !== null ? "object " + JSON.stringify(value) : typeof value + " " + String(value))).join("|") + ">";
}

function lengthOfTheGroup(match, group) {
  return String(group.length);
}

function upperGroup(match, group) {
  return group.toUpperCase();
}

function groupPlusOffset(match, group, offset) {
  return "[" + (group + offset) + "]";
}

function offsetPlusOne(match, offset) {
  return "[" + (offset + 1) + "]";
}

function wholeLength(match, offset, whole) {
  return "[" + whole.length + typeof whole + "]";
}

for (let i = 0; i < 2000; i++) {
  "a1b2".replace(/([a-z])/g, lengthOfTheGroup);
  "a1b2".replace(/([a-z])/g, upperGroup);
  "a1b2".replace(/([a-z])/g, groupPlusOffset);
  "a1b2".replace("1", offsetPlusOne);
  "a1b2".replace("1", wholeLength);
}

attempt("what a text pattern passes", () => "hello".replace("l", describeArguments));
attempt("what a pattern without groups passes", () => "hello".replace(/l/g, describeArguments));
attempt("what a pattern with groups passes", () => "hello".replace(/(l)(x)?(l)/, describeArguments));
attempt("what a pattern with named groups passes", () => "hello".replace(/(?<first>l)(?<missing>x)?/, describeArguments));
attempt("what replaceAll passes", () => "hello".replaceAll("l", describeArguments));
attempt("what an empty pattern passes", () => "hi".replaceAll("", describeArguments));

attempt("a group that took part", () => "ab".replace(/(a)|(b)/g, lengthOfTheGroup));
attempt("a group that did not take part has no length", () => "ba".replace(/(a)|(b)/g, lengthOfTheGroup));
attempt("a group that did not take part has no methods", () => "ba".replace(/(a)|(b)/g, upperGroup));
attempt("a group that did not take part is added to a number", () => "ba".replace(/(a)|b/g, groupPlusOffset));
attempt("without a group the second argument is a number", () => "ab".replace(/a/, upperGroup));
attempt("without a group the second argument has no length", () => "ab".replace(/a/, lengthOfTheGroup));
attempt("with a group the second argument is a text", () => "ab".replace(/(a)/, offsetPlusOne));
attempt("with a group the third argument is a number", () => "ab".replace(/(a)/, wholeLength));
attempt("the whole text of a wrapped text is a plain text", () => new String("a1").replace("1", wholeLength));
attempt("the whole text of a number", () => String.prototype.replace.call(212, "1", wholeLength));

attempt("the same callbacks called by hand", () => [lengthOfTheGroup("m", "group"), lengthOfTheGroup("m", ["a", "b"]), lengthOfTheGroup("m", { length: -0 }), upperGroup("m", { toUpperCase: () => 5 }), groupPlusOffset("m", 1, 2), groupPlusOffset("m", "1", 2), offsetPlusOne("m", "1"), wholeLength("m", 0, [1, 2])]);
attempt("the same callbacks called by hand with nothing", () => lengthOfTheGroup("m"));

const results = [
  "'text'",
  "5",
  "-0",
  "null",
  "undefined",
  "true",
  "5n",
  "[]",
  "[1, 2]",
  "{}",
  "new String('wrapped')",
  "'$&$1$$'",
  "{ toString() { return '$&'; } }",
  "{ toString() { return 5; }, valueOf() { return 'no'; } }",
  "{ [Symbol.toPrimitive](hint) { return hint; } }",
  "Symbol('s')",
  "{ toString() { throw new RangeError('no'); } }",
];
for (const text of results) {
  attempt("a callback returns " + text, () => "a-b".replace("-", () => make(text)));
  attempt("a callback for a pattern returns " + text, () => "a-b-c".replace(/-/g, () => make(text)));
  attempt("the replacement itself is " + text, () => "a-b".replace("-", make(text)));
}
attempt("a callback that changes the pattern's position", () => {
  const pattern = /a/g;
  return ["aaaa".replace(pattern, () => { pattern.lastIndex = 3; return "b"; }), pattern.lastIndex];
});
attempt("a callback that throws halfway", () => {
  let calls = 0;
  try {
    return "aaaa".replace(/a/g, () => { if (++calls === 3) throw new RangeError("no"); return "b"; });
  } catch (error) {
    return [calls, error.constructor.name];
  }
});
