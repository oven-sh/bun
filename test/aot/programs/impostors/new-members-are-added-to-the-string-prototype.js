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
  return text.shout();
}

function kindOfThis(text) {
  return text.kindOfThis();
}

function doubled(text) {
  return text.doubled;
}

function store(text, value) {
  text.remembered = value;
  return text.remembered;
}

function lengthAndShout(text) {
  return text.length + text.shout();
}

function hasShout(text) {
  return ["shout" in Object(text), Object.hasOwn(Object(text), "shout"), typeof text.shout];
}

attempt("before anything is added", () => shout("hello"));
attempt("a member that is missing reads as undefined", () => [doubled("hello"), hasShout("hello")]);
attempt("before the setter is added, a store into a plain text", () => store("hello", 3));
attempt("before the setter is added, a store into a wrapped text", () => store(new String("hello"), 4));

String.prototype.shout = function () {
  return this.toUpperCase() + "!";
};
String.prototype.kindOfThis = function () {
  return typeof this;
};
Object.defineProperty(String.prototype, "doubled", {
  get() {
    return typeof this + " " + this + this;
  },
  configurable: true,
});

for (let i = 0; i < 2000; i++) {
  shout("hello");
  kindOfThis("hello");
  doubled("hello");
  lengthAndShout("hello");
  hasShout("hello");
}

const values = [
  "'hello'",
  "''",
  "'hel' + 'lo'",
  "'\\u4e16'",
  "new String('hello')",
  "Object.assign(new String('hello'), { shout() { return 'own shout'; }, doubled: 'own doubled' })",
  "Object.setPrototypeOf(new String('hello'), null)",
  "Object.setPrototypeOf(new String('hello'), { shout() { return 'other prototype'; } })",
  "new (class Quiet extends String { shout() { return 'quiet ' + super.shout(); } })('hello')",
  "['hello']",
  "{ shout() { return 'look alike'; }, kindOfThis() { return 'look alike'; }, doubled: 'look alike', length: 1 }",
  "5",
  "null",
  "undefined",
  "Symbol('s')",
  "Object.create(String.prototype)",
  "String.prototype",
  "new Proxy(new String('hello'), {})",
];

for (const text of values) {
  attempt("shout " + text, () => shout(make(text)));
  attempt("kind of this " + text, () => kindOfThis(make(text)));
  attempt("doubled " + text, () => doubled(make(text)));
  attempt("length and shout " + text, () => lengthAndShout(make(text)));
  attempt("has shout " + text, () => hasShout(make(text)));
}

attempt("the new members are enumerable or not as they were defined", () => {
  const seen = [];
  for (const key in "hi") seen.push(key);
  return [seen, Object.keys(String.prototype), Object.keys("hi")];
});
attempt("borrowed by other values", () => [String.prototype.shout.call(5), String.prototype.shout.call(["a", "b"]), String.prototype.kindOfThis.call(5), String.prototype.kindOfThis.call(null)]);
attempt("borrowed by null", () => String.prototype.shout.call(null));
attempt("read by a computed name", () => ["hello"[make("'sho' + 'ut'")](), "hello"[make("'doubled'")]]);
attempt("called from eval", () => make("'from eval'.shout()"));

const stored = [];
Object.defineProperty(String.prototype, "remembered", {
  set(value) {
    stored.push(typeof this + " " + this + " " + value);
  },
  get() {
    return "from the getter of " + typeof this;
  },
  configurable: true,
});
attempt("a setter on the prototype is called for a plain text", () => [store("hello", 1), stored.splice(0)]);
attempt("a setter on the prototype is called for a wrapped text", () => [store(new String("hello"), 2), stored.splice(0)]);
attempt("a setter on the prototype is not reached from a number", () => [store(Object(5), 3), stored.splice(0)]);
