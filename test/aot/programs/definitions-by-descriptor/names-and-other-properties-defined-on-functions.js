const lines = [];
const show = value => (typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function " + value.name : JSON.stringify(value));

function describe(label, target, inAnyOrder = false) {
  const parts = [];
  for (const key of Reflect.ownKeys(target)) {
    const d = Object.getOwnPropertyDescriptor(target, key);
    const flags = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
    parts.push(String(key) + ":" + flags + ":" + ("value" in d ? (key === "prototype" ? "object" : show(d.value)) : "accessor"));
  }
  lines.push(label + " | " + (inAnyOrder ? parts.sort() : parts).join(" "));
}

function attempt(label, action) {
  try {
    lines.push(label + " -> " + show(action()));
  } catch (error) {
    lines.push(label + " threw " + error.constructor.name);
  }
}

// What a library of schemas does for each kind of schema.
function makeConstructor(name, initializer, params) {
  function init(instance, definition) {
    instance.traits ??= new Set();
    instance.traits.add(name);
    initializer(instance, definition);
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {}
  Object.defineProperty(Definition, "name", { value: name });
  function made(definition) {
    const instance = params?.Parent ? new Definition() : this;
    init(instance, definition);
    return instance;
  }
  Object.defineProperty(made, "init", { value: init });
  Object.defineProperty(made, Symbol.hasInstance, { value: instance => !!instance?.traits?.has(name) });
  Object.defineProperty(made, "name", { value: name });
  return { made, Definition };
}

const kinds = [];
for (const name of ["First", "Second", "Third", "made", "Definition", ""]) kinds.push(makeConstructor(name, (instance, definition) => void (instance.definition = definition), name === "Second" ? { Parent: Map } : undefined));
for (const { made, Definition } of kinds) {
  describe("made", made);
  describe("class", Definition);
  const instance = new made(made.name.length);
  lines.push([made.name, Definition.name, instance instanceof made, {} instanceof made, instance.definition, instance.constructor.name, Object.getPrototypeOf(Definition) === (made.name === "Second" ? Map : Object)].join(" | "));
  lines.push([String(made).slice(0, 13), String(Definition).slice(0, 16), new Definition() instanceof Definition, Definition.prototype.constructor === Definition].join(" | "));
}
lines.push(kinds[0].made.init === kinds[1].made.init, kinds[0].Definition === kinds[1].Definition);

// Every kind of function, told a name.
const functions = {
  declared: function declared() {},
  arrow: () => 1,
  method: { method() {} }.method,
  getter: Object.getOwnPropertyDescriptor({ get getter() { return 1; } }, "getter").get,
  asynchronous: async function asynchronous() {},
  generator: function* generator() {},
  bound: function target() {}.bind(null),
  classObject: class Plain {},
  withStaticMethod: class WithStaticMethod { static name() { return "called"; } },
  withStaticField: class WithStaticField { static name = "field"; },
  withOtherField: class WithOtherField { static other = 1; static more() {} },
  anonymous: (() => class {})(),
  heir: class Heir extends Array {},
  native: Math.max,
};
for (const [label, target] of Object.entries(functions)) {
  describe(label + " at birth", target);
  attempt(label + " string", () => Object.defineProperty(target, "name", { value: "told" }).name);
  describe(label + " told", target);
  attempt(label + " again", () => Object.defineProperty(target, "name", { value: "told twice" }).name);
  attempt(label + " number", () => Object.defineProperty(target, "name", { value: 7 }).name);
  attempt(label + " symbol", () => Object.defineProperty(target, "name", { value: Symbol.iterator }).name);
  attempt(label + " written", () => { "use strict"; target.name = "written"; return target.name; });
  attempt(label + " writable", () => Object.defineProperty(target, "name", { value: "open", writable: true }).name);
  attempt(label + " written now", () => { "use strict"; target.name = "written"; return target.name; });
  attempt(label + " deleted", () => delete target.name);
  describe(label + " without", target);
  attempt(label + " defined anew", () => Object.defineProperty(target, "name", { value: "anew" }).name);
  // The engine puts a name that comes back where it was.
  describe(label + " anew", target, true);
  attempt(label + " cannot change", () => Object.defineProperty(target, "name", { value: "other" }).name);
  attempt(label + " same value", () => Object.defineProperty(target, "name", { value: "anew" }).name);
}

// The name that it has already, and the names that frames show.
function keepsItsName() { return new Error("here").stack.split("\n")[1].trim().split(" ")[1]; }
attempt("restated", () => Object.defineProperty(keepsItsName, "name", { value: "keepsItsName" }).name);
describe("restated", keepsItsName);
lines.push(keepsItsName());
function renamed() { return new Error("here").stack.split("\n")[1].trim().split(" ")[1]; }
Object.defineProperty(renamed, "name", { value: "shownInFrames" });
lines.push(renamed());
class Thrower { static raise() { return new Thrower(); } constructor() { this.frame = new Error("here").stack.split("\n")[1].trim().split(" ").slice(1, 3).join(" "); } }
Object.defineProperty(Thrower, "name", { value: "RenamedThrower" });
lines.push(Thrower.raise().frame, Thrower.name);

// Functions that cannot take it.
for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
  for (const make of [() => function plain() {}, () => () => 1, () => class Closed {}, () => class ClosedWithMembers { static member() {} }]) {
    const target = close(make());
    attempt(close.name + " name", () => Object.defineProperty(target, "name", { value: "late" }).name);
    attempt(close.name + " other", () => Object.defineProperty(target, "other", { value: 1 }).other);
    describe(close.name, target);
  }
}

// Other names, every shape of descriptor.
const descriptors = [{ value: 1 }, { value: 2, writable: true }, { value: 3, enumerable: true }, { value: 4, configurable: true }, { value: 5, writable: true, enumerable: true, configurable: true }, {}, { get() { return 6; } }, { set(v) {} }, { get() { return 7; }, set(v) {}, enumerable: true, configurable: true }, { writable: true }];
for (const make of [() => function plain(a, b) {}, () => x => x, () => class Target { static member() {} }, () => class Bare {}, () => ({ m() {} }).m, () => function target() {}.bind(null)]) {
  const target = make();
  descriptors.forEach((descriptor, index) => attempt("key" + index, () => Object.defineProperty(target, "key" + index, descriptor)["key" + index]));
  for (const key of ["length", "prototype", "displayName", "0", "caller", Symbol.hasInstance, Symbol.toStringTag, "member", "constructor", "__proto__"]) attempt(String(key), () => Object.defineProperty(target, key, { value: "defined" })[key]);
  describe("all", target);
  attempt("instanceof", () => ({}) instanceof target);
}

// A function that other objects inherit from: what reads have found absent appears.
function parent() {}
const heir = Object.create(parent);
class Below extends parent {}
let seen = "";
for (let round = 0; round < 6; round++) {
  seen += [heir.late, Below.late, "late" in heir, heir.name, Below.init].join() + ";";
  if (round === 2) Object.defineProperty(parent, "late", { value: "now" });
  if (round === 3) Object.defineProperty(parent, "name", { value: "renamed parent" });
  if (round === 4) Object.defineProperty(parent, "init", { get() { return "got by " + this.name; } });
}
lines.push(seen);

console.log(lines.join("\n"));
