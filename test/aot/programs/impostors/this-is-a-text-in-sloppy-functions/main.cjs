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

function kindOfThis() {
  return typeof this;
}

function thisIsHello() {
  return [this === "hello", this == "hello", this instanceof String];
}

function lengthOfThis() {
  return this.length;
}

function firstCode() {
  return this.charCodeAt(0);
}

function rememberOnThis() {
  this.remembered = "yes";
  return this.remembered;
}

function returnThis() {
  return this;
}

function thisTwice() {
  return returnThis.call(this) === this;
}

function strictKindOfThis() {
  "use strict";
  return typeof this;
}

function arrowInside() {
  return (() => typeof this)();
}

function isTheGlobalObject() {
  return this === globalThis;
}

const uses = [
  ["kind", kindOfThis],
  ["is hello", thisIsHello],
  ["length", lengthOfThis],
  ["first code", firstCode],
  ["remember", rememberOnThis],
  ["twice", thisTwice],
  ["strict kind", strictKindOfThis],
  ["arrow inside", arrowInside],
  ["is the global object", isTheGlobalObject],
];

const values = ["'hello'", "''", "new String('hello')", "5", "true", "Symbol('s')", "5n", "null", "undefined", "['h']", "{ length: 1, charCodeAt() { return 'look alike'; } }"];

for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use.call("hello");
}

for (const [name, use] of uses) {
  for (const text of values) attempt(name + " with this = " + text, () => use.call(make(text)));
  attempt(name + " called plainly", () => (use === rememberOnThis || use === lengthOfThis || use === firstCode ? "skipped" : use()));
}

attempt("this comes back wrapped", () => [typeof returnThis.call("hello"), returnThis.call("hello") === returnThis.call("hello"), returnThis.call("hello") == "hello"]);
attempt("a wrapped this is passed as it is", () => {
  const wrapped = new String("hello");
  return returnThis.call(wrapped) === wrapped;
});

String.prototype.sloppyKind = function () {
  return typeof this;
};
String.prototype.strictKind = function () {
  "use strict";
  return typeof this;
};
Object.defineProperty(String.prototype, "sloppyGetter", { get() { return typeof this; }, configurable: true });
Object.defineProperty(String.prototype, "strictGetter", { get() { "use strict"; return typeof this; }, configurable: true });
attempt("members added to String.prototype", () => ["hello".sloppyKind(), "hello".strictKind(), "hello".sloppyGetter, "hello".strictGetter, new String("hello").sloppyKind(), new String("hello").strictKind()]);
attempt("handed to map with a text as this", () => [1].map(kindOfThis, "hello").concat([1].map(strictKindOfThis, "hello")));
attempt("handed to replace", () => "a".replace("a", kindOfThis) + "a".replace("a", strictKindOfThis));
