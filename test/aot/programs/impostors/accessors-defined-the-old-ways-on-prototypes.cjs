const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function getFull() {
  log.push("get full");
  return this.first + " " + this.last;
}

function setFull(value) {
  log.push("set full");
  const parts = String(value).split(" ");
  this.first = parts[0];
  this.last = parts[1];
}

const definers = [
  ["__defineGetter__ and __defineSetter__", prototype => { prototype.__defineGetter__("full", getFull); prototype.__defineSetter__("full", setFull); }],
  ["Object.defineProperty", prototype => { Object.defineProperty(prototype, "full", { get: getFull, set: setFull, enumerable: true, configurable: true }); }],
  ["Object.defineProperties", prototype => { Object.defineProperties(prototype, { full: { get: getFull, set: setFull, enumerable: true, configurable: true } }); }],
  ["a literal prototype with get and set", (prototype, Maker) => { Maker.prototype = { get full() { return getFull.call(this); }, set full(value) { setFull.call(this, value); } }; }],
  ["Object.create with descriptors", (prototype, Maker) => { Maker.prototype = Object.create(Object.prototype, { full: { get: getFull, set: setFull, enumerable: true, configurable: true } }); }],
  ["Reflect.defineProperty", prototype => { Reflect.defineProperty(prototype, "full", { get: getFull, set: setFull, enumerable: true, configurable: true }); }],
  ["only __defineGetter__", prototype => { prototype.__defineGetter__("full", getFull); }],
  ["only __defineSetter__", prototype => { prototype.__defineSetter__("full", setFull); }],
];

function fullOf(person) {
  return person.full;
}

function rename(person, value) {
  person.full = value;
  return person;
}

for (const [label, define] of definers) {
  function Person(first, last) {
    this.first = first;
    this.last = last;
  }
  define(Person.prototype, Person);

  let length = 0;
  for (let i = 0; i < 2000; i++) length += String(fullOf(rename(new Person("a", "b"), "c d" + (i % 3)))).length;
  log.length = 0;
  console.log(label + ": 2000 honest rounds", length);

  attempt(label + ": full", () => fullOf(new Person("ann", "lee")));
  attempt(label + ": full = ..", () => rename(new Person("ann", "lee"), "bob ray"));
  attempt(label + ": for-in", () => { const names = []; for (const name in new Person("ann", "lee")) names.push(name); return names; });
  attempt(label + ": __lookupGetter__", () => new Person("ann", "lee").__lookupGetter__("full") === getFull);
  attempt(label + ": __lookupSetter__", () => new Person("ann", "lee").__lookupSetter__("full") === setFull);
  attempt(label + ": an own full shadows it", () => fullOf(Object.defineProperty(new Person("ann", "lee"), "full", { value: "own full" })));
  attempt(label + ": a literal with first and last", () => fullOf({ first: "ann", last: "lee" }));
  attempt(label + ": a literal under the prototype", () => fullOf({ __proto__: Person.prototype, last: "lee", first: "ann" }));
  attempt(label + ": a store into a literal under the prototype", () => rename({ __proto__: Person.prototype }, "bob ray"));
  attempt(label + ": a store into a frozen person", () => rename(Object.freeze(new Person("ann", "lee")), "bob ray"));
  attempt(label + ": the getter with a number as this", () => { const found = Object.getOwnPropertyDescriptor(Person.prototype, "full").get; return found ? found.call(5) : "no getter"; });
  delete Person.prototype.full;
  attempt(label + ": after the accessor was deleted, full", () => fullOf(new Person("ann", "lee")));
  attempt(label + ": after the accessor was deleted, full = ..", () => rename(new Person("ann", "lee"), "bob ray"));
}
