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

function report(label, run) {
  attempt(label, run);
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

function splitBy(text, separator) {
  return text.split(separator);
}

function replaceBy(text, pattern) {
  return text.replace(pattern, "+");
}

function replaceAllBy(text, pattern) {
  return text.replaceAll(pattern, "+");
}

function matchBy(text, pattern) {
  const found = text.match(pattern);
  return found && typeof found === "object" ? found[0] : found;
}

function searchBy(text, pattern) {
  return text.search(pattern);
}

function includesBy(text, piece) {
  return text.includes(piece);
}

function all(pattern) {
  return [splitBy("a-b1c", pattern), replaceBy("a-b1c", pattern), replaceAllBy("a-b1c", pattern), matchBy("a-b1c", pattern), searchBy("a-b1c", pattern), includesBy("a-b1c", pattern)];
}

for (let i = 0; i < 2000; i++) all("-");

function answering(name) {
  return function (...given) {
    log.push(name + " called with this " + typeof this + " and " + given.length + " arguments");
    return name + " answered";
  };
}

class Separator extends String {
  [Symbol.split] = answering("own split");
}

class Pattern extends String {}
Pattern.prototype[Symbol.replace] = answering("inherited replace");
Pattern.prototype[Symbol.match] = answering("inherited match");
Pattern.prototype[Symbol.search] = answering("inherited search");
Pattern.prototype[Symbol.split] = answering("inherited split");

class Count extends Number {}
Count.prototype[Symbol.replace] = answering("number replace");
Count.prototype[Symbol.split] = answering("number split");

report("a plain text", () => all("-"));
report("a plain number", () => all(1));
report("a wrapped text", () => all(new String("-")));
report("a wrapped number", () => all(new Number(1)));
report("a wrapped text with a split of its own", () => all(new Separator("-")));
report("a wrapped text that inherits four methods", () => all(new Pattern("-")));
report("a wrapped number that inherits two methods", () => all(new Count(1)));
report("a wrapped text with own methods added later", () => all(Object.assign(new String("-"), { [Symbol.replace]: answering("added replace"), [Symbol.search]: answering("added search") })));
report("a wrapped text whose Symbol.match is false", () => all(Object.assign(new String("-"), { [Symbol.match]: false })));
report("a wrapped text whose Symbol.match is true", () => all(Object.assign(new String("-"), { [Symbol.match]: true })));
report("a wrapped text with another prototype", () => all(Object.setPrototypeOf(new String("-"), { [Symbol.split]: answering("other prototype split"), toString: () => "1" })));
report("a list with a split of its own", () => all(Object.assign(["-"], { [Symbol.split]: answering("list split") })));
report("the value of the subclass instance is still its text", () => [String(new Pattern("-")), new Pattern("-") + "", new Pattern("-").length, `${new Separator("-")}`]);

class Primitive extends String {
  [Symbol.toPrimitive](hint) {
    log.push("toPrimitive " + hint);
    return "converted";
  }
}
report("Symbol.toPrimitive on a subclass", () => [new Primitive("a") + "b", `${new Primitive("a")}`, { a: 1, converted: 2 }[new Primitive("a")], new Primitive("a") == "a", new Primitive("a") == "converted", new Primitive("a") < "b", "x".concat(new Primitive("a")), ["x", new Primitive("a")].join("-"), new Primitive("abc").length, new Primitive("abc").toUpperCase()]);

class Spread extends String {
  get [Symbol.isConcatSpreadable]() {
    log.push("asked whether it spreads");
    return true;
  }
}
report("Symbol.isConcatSpreadable on a subclass", () => [[].concat(new Spread("ab")), [].concat("ab"), [].concat(new String("ab")).length, ["x"].concat(new Spread("ab"), ["y"])]);

class Tagged extends String {
  get [Symbol.toStringTag]() {
    return "Text";
  }
}
report("Symbol.toStringTag on a subclass", () => [Object.prototype.toString.call(new Tagged("a")), Object.prototype.toString.call(new String("a")), Object.prototype.toString.call("a"), String(new Tagged("a"))]);

class Walked extends String {
  *[Symbol.iterator]() {
    log.push("its own iterator");
    yield "walked";
  }
}
report("Symbol.iterator on a subclass", () => [[...new Walked("ab")], Array.from(new Walked("ab")), [...new String("ab")], new Set(new Walked("ab")).size, Math.max(...new Walked("ab").length.toString())]);

report("instanceof a wrapped text with Symbol.hasInstance", () => [5 instanceof Object.assign(new String("a"), { [Symbol.hasInstance]: () => true })]);
report("instanceof a wrapped text", () => 5 instanceof new String("a"));
report("instanceof a plain text", () => 5 instanceof "a");
report("honest again", () => all("-"));
