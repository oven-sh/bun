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

const settings = {
  title: "hello world",
  author: "ada",
  count: 12345,
  tags: ["h", "e", "l", "l", "o"],
  wrapped: new String("hello world"),
  nothing: null,
  look: { length: 2, charCodeAt: () => "look alike", toUpperCase: () => "LOOK ALIKE", slice: () => "look", indexOf: () => "alike", 0: "L" },
  get computed() {
    return "from a getter";
  },
};

function lengthOf(name) {
  return settings[name].length;
}

function firstCodeOf(name) {
  return settings[name].charCodeAt(0);
}

function upperOf(name) {
  return settings[name].toUpperCase();
}

function headOf(name) {
  return settings[name].slice(0, 2);
}

function positionOfL(name) {
  return settings[name].indexOf("l");
}

function firstOf(name) {
  return settings[name][0];
}

function labelOf(name) {
  return name + ": " + settings[name];
}

function isHello(name) {
  return settings[name] === "hello world";
}

const uses = [
  ["length", lengthOf],
  ["first code", firstCodeOf],
  ["upper", upperOf],
  ["head", headOf],
  ["position of l", positionOfL],
  ["first", firstOf],
  ["label", labelOf],
  ["is hello", isHello],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  const name = i % 2 ? "title" : "author";
  for (const [, use] of uses) total += String(use(name)).length;
}
console.log("2000 honest rounds", total);

const names = ["'ti' + 'tle'", "'count'", "'tags'", "'wrapped'", "'nothing'", "'look'", "'computed'", "'missing'", "'constructor'", "'toString'", "'__proto__'", "['title']", "{ toString() { return 'author'; } }", "Symbol('title')", "0", "null"];

for (const [label, use] of uses) {
  for (const name of names) attempt(label + " of settings[" + name + "]", () => use(make(name)));
  attempt(label + " of the title again", () => use("title"));
}

settings.title = 42;
attempt("the title was replaced by a number", () => [lengthOf("title"), labelOf("title"), isHello("title"), firstOf("title")]);
attempt("the title was replaced by a number: methods", () => upperOf("title"));
settings["ti" + make("'tle'")] = ["hello world"];
attempt("the title was replaced by a list", () => [lengthOf("title"), labelOf("title"), isHello("title"), firstOf("title"), headOf("title"), positionOfL("title")]);
delete settings.title;
attempt("the title was deleted", () => labelOf("title"));
attempt("the title was deleted: length", () => lengthOf("title"));
Object.defineProperty(settings, "title", { get: () => "hello world", configurable: true });
attempt("the title is a getter", () => [lengthOf("title"), firstCodeOf("title"), isHello("title")]);
