// A symbol is a different key than its text.
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

function read(table, key) {
  return table[key];
}

function store(table, key, value) {
  table[key] = value;
  return table;
}

function label(key) {
  return "key: " + key;
}

function labelInATemplate(key) {
  return `key: ${key}`;
}

function labelByString(key) {
  return "key: " + String(key);
}

function readAndLabel(table, key) {
  return key + "=" + table[key];
}

const plain = Symbol("a");
const registered = Symbol.for("a");
const nameless = Symbol();

function makeTable() {
  return { a: "text a", "Symbol(a)": "text Symbol(a)", "Symbol()": "text Symbol()", "": "empty text", undefined: "text undefined", [plain]: "plain symbol", [registered]: "registered symbol", [nameless]: "nameless symbol", [Symbol.iterator]: "the iterator symbol", "Symbol(Symbol.iterator)": "text of the iterator symbol", "@@iterator": "old name" };
}

for (let i = 0; i < 2000; i++) {
  read(makeTable(), "a");
  store({}, "a", 1);
  label("a");
  labelInATemplate("a");
  labelByString("a");
  readAndLabel({ a: 1 }, "a");
}

const keys = [
  ["'a'", "a"],
  ["plain", plain],
  ["another of the same description", Symbol("a")],
  ["registered", registered],
  ["registered again", Symbol.for("a")],
  ["registered from eval", make("Symbol.for('a')")],
  ["nameless", nameless],
  ["Symbol.iterator", Symbol.iterator],
  ["Symbol.iterator from eval", make("Symbol.iterator")],
  ["the description", plain.description],
  ["the text", plain.toString()],
  ["the text of the nameless one", nameless.toString()],
  ["the description of the nameless one", nameless.description],
  ["a wrapped symbol", Object(plain)],
  ["an object that converts to the symbol", { [Symbol.toPrimitive]: () => plain }],
  ["a list of the text", ["a"]],
];

for (const [name, key] of keys) {
  attempt("read by " + name, () => read(makeTable(), key));
  attempt("label " + name, () => label(key));
  attempt("template " + name, () => labelInATemplate(key));
  attempt("String " + name, () => labelByString(key));
  attempt("read and label " + name, () => readAndLabel(makeTable(), key));
  attempt("store by " + name, () => Reflect.ownKeys(store({ a: 0 }, key, 1)).map(String));
}

const table = makeTable();
attempt("Object.keys", () => Object.keys(table));
attempt("own names", () => Object.getOwnPropertyNames(table).length);
attempt("own symbols", () => Object.getOwnPropertySymbols(table).map(String));
attempt("JSON", () => JSON.stringify(table));
attempt("for-in", () => {
  const seen = [];
  for (const key in table) seen.push(key);
  return seen.length;
});
attempt("spread keeps symbols", () => Reflect.ownKeys({ ...table }).length);
attempt("Object.assign keeps symbols", () => Reflect.ownKeys(Object.assign({}, table)).length);
attempt("Object.entries does not", () => Object.entries(table).length);
attempt("rest keeps the other symbols", () => {
  const { [plain]: taken, a, ...rest } = table;
  return [taken, a, Reflect.ownKeys(rest).length];
});
attempt("in", () => [plain in table, Symbol("a") in table, "Symbol(a)" in table, Symbol.for("a") in table]);
attempt("a symbol compared", () => [plain == "Symbol(a)", plain === plain, plain == Object(plain), plain === Object(plain), Symbol.for("a") === registered, plain == "a"]);
attempt("a symbol ordered", () => plain < "a");
attempt("a symbol to a number", () => +plain);
attempt("a symbol is truthy", () => [!plain, plain ? "yes" : "no", plain && "and", plain || "or"]);
attempt("a symbol in a list that is joined", () => [plain].join());
attempt("a symbol in a list that is turned into JSON", () => JSON.stringify([plain, { key: plain }]));
attempt("a symbol as a key of a list", () => {
  const list = store(["x"], plain, "y");
  return [list.length, list[plain], Object.keys(list)];
});
attempt("a symbol as a key of a text", () => [read("text", plain), typeof read("text", Symbol.iterator)]);
attempt("a symbol stored into a text", () => store("text", plain, 1));
