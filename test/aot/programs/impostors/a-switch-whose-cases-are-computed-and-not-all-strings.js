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

const log = [];

function label(name, value) {
  log.push(name);
  return value;
}

function computedCases(value) {
  switch (value) {
    case label("first", "a"):
      return "first";
    case label("second", new String("a")):
      return "second";
    case label("third", "a" + "b"):
      return "third";
    case label("fourth", 1):
      return "fourth";
    case label("fifth", "1"):
      return "fifth";
    default:
      return "default";
    case label("sixth", null):
      return "sixth";
  }
}

const wrapped = new String("same object");

function casesThatAreVariables(value, one, two) {
  switch (value) {
    case one:
      return "one";
    case two:
      return "two";
    case wrapped:
      return "the wrapped text itself";
    case "same object":
      return "the plain text";
  }
  return "none";
}

function switchOnTrue(value) {
  switch (true) {
    case value === "a":
      return "is a";
    case value == "a":
      return "is loosely a";
    case typeof value === "string":
      return "another text";
    case value:
      return "true itself";
  }
  return "none";
}

function switchOnTypeof(value) {
  switch (typeof value) {
    case "string":
      return "text of " + value.length;
    case "object":
      return value === null ? "null" : "object";
    case "number":
    case "bigint":
      return "numeric";
    case "symbol":
      return "symbol";
    case "undefined":
      return "undefined";
  }
  return typeof value;
}

function switchOnLength(value) {
  switch (value.length) {
    case 0:
      return "empty";
    case 1:
      return "one";
    case "1":
      return "the text one";
    case undefined:
      return "no length";
  }
  return "longer";
}

function switchOnFirstCharacter(value) {
  switch (value[0]) {
    case "a":
      return "starts with a";
    case 97:
      return "starts with 97";
    case undefined:
      return "starts with nothing";
  }
  return "starts with something else";
}

for (let i = 0; i < 2000; i++) {
  computedCases("ab");
  casesThatAreVariables("x", "x", "y");
  switchOnTrue("a");
  switchOnTypeof("a");
  switchOnLength("a");
  switchOnFirstCharacter("a");
}
log.length = 0;

const values = ["'a'", "'ab'", "'1'", "1", "null", "undefined", "new String('a')", "['a']", "true", "''", "'same object'", "new String('same object')", "Symbol('a')", "1n", "Buffer.from('a')", "{ length: '1', 0: 97 }", "[]", "function f(x) {}"];

for (const text of values) {
  attempt("computed cases " + text, () => computedCases(make(text)));
  console.log("  evaluated:", log.splice(0).join(" "));
  attempt("variables " + text, () => casesThatAreVariables(make(text), "a", 1));
  attempt("on true " + text, () => switchOnTrue(make(text)));
  attempt("on typeof " + text, () => switchOnTypeof(make(text)));
  attempt("on length " + text, () => switchOnLength(make(text)));
  attempt("on the first character " + text, () => switchOnFirstCharacter(make(text)));
}
attempt("the wrapped text itself", () => casesThatAreVariables(wrapped, "a", "b"));
attempt("a case that is the same wrapped text", () => casesThatAreVariables(wrapped, wrapped, "b"));
attempt("NaN never matches itself", () => casesThatAreVariables(NaN, NaN, "b"));
attempt("minus zero matches zero", () => casesThatAreVariables(-0, "0", 0));

console.log("bytes made in plain sight", Buffer.from("he").length);
