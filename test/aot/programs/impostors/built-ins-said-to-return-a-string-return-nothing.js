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

function kind(text) {
  return text === undefined ? "undefined" : text === null ? "null" : typeof text;
}

function stringified(value) {
  const text = JSON.stringify(value);
  return [kind(text), typeof text === "string" ? text.length : "no length"];
}

function stringifiedLength(value) {
  return JSON.stringify(value).length;
}

function stringifiedLabel(value) {
  return "<" + JSON.stringify(value) + ">";
}

function dateAsJson(time) {
  const text = new Date(time).toJSON();
  return [kind(text), text === null];
}

function dateAsJsonLength(time) {
  return new Date(time).toJSON().length;
}

function description(symbol) {
  const text = symbol.description;
  return [kind(text), text === undefined];
}

function descriptionLength(symbol) {
  return symbol.description.length;
}

function keyFor(symbol) {
  const text = Symbol.keyFor(symbol);
  return [kind(text), text === undefined];
}

function keyForUpper(symbol) {
  return Symbol.keyFor(symbol).toUpperCase();
}

function parameter(query, name) {
  const text = new URLSearchParams(query).get(name);
  return [kind(text), text === null];
}

function parameterLength(query, name) {
  return new URLSearchParams(query).get(name).length;
}

function header(name) {
  const text = new Headers({ present: "yes" }).get(name);
  return [kind(text), text === null];
}

function headerUpper(name) {
  return new Headers({ present: "yes" }).get(name).toUpperCase();
}

function fromAMap(key) {
  const text = new Map([["present", "yes"]]).get(key);
  return [kind(text), text === undefined];
}

function fromAMapLength(key) {
  return new Map([["present", "yes"]]).get(key).length;
}

function environment(name) {
  const text = process.env[name];
  return [kind(text), text === undefined];
}

function environmentLength(name) {
  return process.env[name].length;
}

function argument(index) {
  const text = process.argv[index];
  return kind(text);
}

function argumentLength(index) {
  return process.argv[index].length;
}

function nameOfKey(object, index) {
  const text = Object.keys(object)[index];
  return [kind(text), text === undefined];
}

function nameOfKeyUpper(object, index) {
  return Object.keys(object)[index].toUpperCase();
}

function ownKeyUpper(object, index) {
  return Reflect.ownKeys(object)[index].toUpperCase();
}

function causeOf(error) {
  const text = error.message;
  return [kind(text), typeof text === "string" ? text.length : "no length"];
}

for (let i = 0; i < 2000; i++) {
  stringified({ a: 1 });
  stringifiedLength({ a: 1 });
  stringifiedLabel({ a: 1 });
  dateAsJson(0);
  dateAsJsonLength(0);
  description(Symbol("s"));
  descriptionLength(Symbol("s"));
  keyFor(Symbol.for("s"));
  keyForUpper(Symbol.for("s"));
  fromAMap("present");
  fromAMapLength("present");
  nameOfKey({ a: 1 }, 0);
  nameOfKeyUpper({ a: 1 }, 0);
  ownKeyUpper({ a: 1 }, 0);
}
for (let i = 0; i < 200; i++) {
  parameter("a=1", "a");
  parameterLength("a=1", "a");
  header("present");
  headerUpper("present");
}

attempt("JSON.stringify(undefined)", () => stringified(undefined));
attempt("JSON.stringify(undefined).length", () => stringifiedLength(undefined));
attempt("'<' + JSON.stringify(undefined) + '>'", () => stringifiedLabel(undefined));
attempt("JSON.stringify(function)", () => stringified(() => {}));
attempt("JSON.stringify(function).length", () => stringifiedLength(() => {}));
attempt("JSON.stringify(symbol)", () => stringified(Symbol("s")));
attempt("JSON.stringify(symbol).length", () => stringifiedLength(Symbol("s")));
attempt("JSON.stringify of toJSON that returns nothing", () => stringified({ toJSON() {} }));
attempt("JSON.stringify of toJSON that returns nothing, length", () => stringifiedLength({ toJSON() {} }));
attempt("JSON.stringify(null)", () => [stringified(null), stringifiedLength(null), stringifiedLabel(null)]);
attempt("JSON.stringify(BigInt)", () => stringified(1n));
attempt("toJSON of an invalid date", () => dateAsJson(NaN));
attempt("toJSON of an invalid date, length", () => dateAsJsonLength(NaN));
attempt("toJSON of a valid date", () => [dateAsJson(0), dateAsJsonLength(0)]);
attempt("description of Symbol()", () => description(Symbol()));
attempt("description of Symbol(), length", () => descriptionLength(Symbol()));
attempt("description of Symbol('')", () => [description(Symbol("")), descriptionLength(Symbol(""))]);
attempt("description of Symbol(undefined)", () => description(Symbol(undefined)));
attempt("keyFor of a symbol that is not registered", () => keyFor(Symbol("s")));
attempt("keyFor of a symbol that is not registered, upper", () => keyForUpper(Symbol("s")));
attempt("keyFor of a well-known symbol", () => keyFor(Symbol.iterator));
attempt("keyFor of a text", () => keyFor("s"));
attempt("a parameter that is missing", () => parameter("a=1", "b"));
attempt("a parameter that is missing, length", () => parameterLength("a=1", "b"));
attempt("a parameter that is empty", () => [parameter("a=", "a"), parameterLength("a", "a")]);
attempt("a header that is missing", () => header("absent"));
attempt("a header that is missing, upper", () => headerUpper("absent"));
attempt("a map key that is missing", () => fromAMap("absent"));
attempt("a map key that is missing, length", () => fromAMapLength("absent"));
attempt("an environment variable that is missing", () => environment("THIS_IS_NEVER_SET_ANYWHERE"));
attempt("an environment variable that is missing, length", () => environmentLength("THIS_IS_NEVER_SET_ANYWHERE"));
attempt("an argument that is missing", () => argument(99));
attempt("an argument that is missing, length", () => argumentLength(99));
attempt("a key past the end", () => nameOfKey({ a: 1 }, 1));
attempt("a key past the end, upper", () => nameOfKeyUpper({ a: 1 }, 1));
attempt("an own key that is a symbol", () => ownKeyUpper({ [Symbol("s")]: 1 }, 0));
attempt("an own key that is a text", () => ownKeyUpper({ 5: 1 }, 0));
attempt("messages", () => [causeOf(new Error()), causeOf(new Error(undefined)), causeOf(new Error(null)), causeOf(new Error(5)), causeOf(Object.assign(new Error("x"), { message: 5 })), causeOf({ message: undefined })]);
