// A program adds members to Set.prototype, Set, Map.prototype and Map before a library module is first loaded. The set of waiting writers of a readable stream with two destinations is of a class of the library below Set: it has a copy of each, and a function without parameters that makes an iterator is wrapped.
function tell(label, ask) {
  try {
    console.log(label, ask());
  } catch (error) {
    console.log(label, error.constructor.name + ": " + error.message);
  }
}
const calls = [];
Set.prototype.takesOne = function (a) {
  return "takesOne " + this.size + " " + a;
};
Set.prototype.takesNone = function () {
  calls.push("takesNone " + this.size);
  return "takesNone " + this.size;
};
Set.prototype.iterates = function () {
  calls.push("iterates " + this.size);
  return this.values();
};
Set.prototype.listed = function () {
  calls.push("listed " + this.size);
  return [...this];
};
Set.prototype.again = Set.prototype.values;
Set.prototype.text = "text";
Object.defineProperty(Set.prototype, "computed", {
  get() {
    return "computed " + this.size;
  },
  configurable: true,
});
Object.defineProperty(Set.prototype, "hidden", {
  value: "hidden",
  enumerable: false,
  writable: false,
  configurable: false,
});
Object.defineProperty(Set.prototype, "hiddenMaker", {
  value() {
    return [].values();
  },
  enumerable: false,
  writable: true,
  configurable: true,
});
Set.prototype[Symbol.for("added")] = "under a symbol";
Set.prototype[Symbol.for("maker")] = function () {
  return new Map().keys();
};
Set.fixed = "fixed";
Set.make = function () {
  return new this();
};
Map.prototype.pairs = function () {
  calls.push("pairs " + this.size);
  return this.entries();
};
Map.extra = "extra";
WeakMap.prototype.weak = function () {
  calls.push("weak");
  return [];
};

const { Readable, Writable } = require("node:stream");
console.log(calls.join(", "));
const readable = new Readable({ read() {} });
const ignore = () => new Writable({ write: (chunk, encoding, done) => done() });
readable.pipe(ignore());
readable.pipe(ignore());
const waiting = readable._readableState.awaitDrainWriters;
const prototype = Object.getPrototypeOf(waiting);
const constructor = prototype.constructor;
const shown = (key, value) => (typeof value === "function" ? "function " + value.name + " " + value.length : value);
tell("is a set", () => waiting instanceof Set);
tell("name", () => constructor.name);
tell("keys", () => Reflect.ownKeys(prototype).map(String).join(" "));
tell("static keys", () => Reflect.ownKeys(constructor).map(String).join(" "));
tell("above", () => Object.getPrototypeOf(prototype));
tell("frozen", () => [Object.isFrozen(prototype), Object.isFrozen(constructor)].join());
const names = ["takesOne", "takesNone", "iterates", "listed", "again", "text", "computed", "hidden", "hiddenMaker"];
for (const name of [...names, Symbol.for("added"), Symbol.for("maker"), "values", "has", "pairs", "weak"]) {
  tell("typeof " + String(name), () => typeof waiting[name]);
  tell("same " + String(name), () => waiting[name] === Set.prototype[name]);
  tell("descriptor " + String(name), () => JSON.stringify(Object.getOwnPropertyDescriptor(prototype, name), shown));
}
tell("call takesOne", () => waiting.takesOne(5));
tell("call takesNone", () => waiting.takesNone());
tell("call listed", () => JSON.stringify(waiting.listed()));
tell("call iterates", () => Object.prototype.toString.call(waiting.iterates()));
tell("iterates constructor", () => waiting.iterates().constructor.name);
tell("iterates next", () => JSON.stringify(waiting.iterates().next()));
tell("iterates spread", () => [...waiting.iterates()].length);
tell("again next", () => JSON.stringify(waiting.again().next()));
tell("hiddenMaker next", () => JSON.stringify(waiting.hiddenMaker().next()));
tell("maker next", () => JSON.stringify(waiting[Symbol.for("maker")]().next()));
tell("two wrappers", () => waiting.iterates().constructor === waiting.listed().constructor);
tell("static fixed", () => constructor.fixed);
tell("static make", () => constructor.make === Set.make);
tell("static make call", () => constructor.make() instanceof constructor);
tell("an ordinary set", () =>
  [new Set([1]).iterates().next().value, new Set([1, 2]).takesOne(3), new Map([[1, 2]]).pairs().next().value].join(),
);
console.log(calls.join(", "));
