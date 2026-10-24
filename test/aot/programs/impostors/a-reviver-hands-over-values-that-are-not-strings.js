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

function shout(text) {
  return text.toUpperCase() + "!";
}

function initial(text) {
  return text[0] + text.charCodeAt(0);
}

function greeting(person) {
  return "hello " + person.name + " of " + person.name.length;
}

function keyKinds(text) {
  const seen = [];
  JSON.parse(text, function (key, value) {
    seen.push(typeof key + " " + JSON.stringify(key) + " in " + (Array.isArray(this) ? "list" : "object"));
    return value;
  });
  return seen;
}

function keysUsedAsNumbers(text) {
  const seen = [];
  JSON.parse(text, (key, value) => {
    seen.push([key + 1, key * 2, key === 0, key === "0", key.length]);
    return value;
  });
  return seen;
}

const source = '{ "name": "ada", "tags": ["x", "y"], "nested": { "name": "grace" } }';

const revivers = [
  ["nothing changed", "(key, value) => value"],
  ["names are wrapped", "(key, value) => key === 'name' ? new String(value) : value"],
  ["names become numbers", "(key, value) => key === 'name' ? value.length : value"],
  ["names become lists", "(key, value) => key === 'name' ? value.split('') : value"],
  ["names become null", "(key, value) => key === 'name' ? null : value"],
  ["names are removed", "(key, value) => key === 'name' ? undefined : value"],
  ["names become symbols", "(key, value) => key === 'name' ? Symbol(value) : value"],
  ["names become bytes", "(key, value) => key === 'name' ? Buffer.from(value) : value"],
  ["names become objects that look like texts", "(key, value) => key === 'name' ? { length: 3, 0: 'A', toUpperCase() { return 'LOOK'; }, charCodeAt() { return -1; }, toString() { return 'alike'; } } : value"],
  ["every text is wrapped", "(key, value) => typeof value === 'string' ? Object(value) : value"],
  ["the whole is replaced by a text", "(key, value) => key === '' ? 'whole' : value"],
];

for (let i = 0; i < 2000; i++) {
  const honest = JSON.parse(source);
  shout(honest.name);
  initial(honest.name);
  greeting(honest);
  shout(honest.tags[0]);
}

for (const [label, text] of revivers) {
  const parse = () => JSON.parse(source, make(text));
  attempt(label + ": shout", () => shout(parse().name));
  attempt(label + ": initial", () => initial(parse().name));
  attempt(label + ": greeting", () => greeting(parse()));
  attempt(label + ": greeting of the nested one", () => greeting(parse().nested));
  attempt(label + ": shout a tag", () => shout(parse().tags[1]));
  attempt(label + ": keys", () => Object.keys(parse()));
  attempt(label + ": back to JSON", () => JSON.stringify(parse()));
}

attempt("kinds of keys", () => keyKinds('{ "a": [10, { "0": 1 }], "1": "x" }'));
attempt("keys used as numbers", () => keysUsedAsNumbers("[5, 6]"));
attempt("honest again", () => [shout(JSON.parse(source).name), initial(JSON.parse(source).name), greeting(JSON.parse(source))]);
attempt("the text that is parsed is not a text", () => [JSON.parse(5), JSON.parse(null), JSON.parse(true), JSON.parse(["1"]), JSON.parse([[2]]), JSON.parse(new String("[3]")), JSON.parse({ toString() { return '{"a":4}'; } })]);
attempt("parsing undefined", () => JSON.parse(undefined));
attempt("parsing a symbol", () => JSON.parse(Symbol("1")));
attempt("parsing an object", () => JSON.parse({}));
attempt("parsing a list of two", () => JSON.parse([1, 2]));
attempt("parsing bytes", () => JSON.parse(Buffer.from("[1]")));
