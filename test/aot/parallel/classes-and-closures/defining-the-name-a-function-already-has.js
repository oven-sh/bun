// Defining the `name` that a function already has, with the attributes it already has, changes nothing that a program can observe: not the property, the order of the own names or the frames of a stack trace, and not what a later definition, store or `delete` does. node:fs does it to each of its functions. Any other definition of `name` takes effect.
function topFrame(run) {
  try {
    run();
  } catch (error) {
    for (const line of error.stack.split("\n")) {
      const frame = /^\s*at (?:(.*?) \()?[^()]*:\d+:\d+\)?$/.exec(line) ?? /^(?:(.*?)@)?.*:\d+:\d+$/.exec(line);
      if (frame) return frame[1] === undefined || frame[1] === "<anonymous>" ? "(anonymous)" : frame[1].replace(/^new /, "");
    }
  }
  return "(no frame)";
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "object" && value !== null ? "object " + JSON.stringify(String(value)) : String(value);
}

function nameProperty(f) {
  const descriptor = Object.getOwnPropertyDescriptor(f, "name");
  if (!descriptor) return "absent";
  const held = "value" in descriptor ? `${show(descriptor.value)} writable=${descriptor.writable}` : "accessor";
  return `${held} enumerable=${descriptor.enumerable} configurable=${descriptor.configurable}`;
}

// `prototype` is listed last. In the language it is made with the function, so it stands in front of a `name` that was deleted and defined again. JavaScriptCore makes it when it is first asked for.
function withPrototypeLast(names) {
  const others = names.filter(name => name !== "prototype");
  return others.length === names.length ? names : [...others, "prototype"];
}

function everything(f) {
  return `${nameProperty(f)}, own names ${withPrototypeLast(Object.getOwnPropertyNames(f)).join()}, enumerable ${Object.keys(f).join() || "none"}, reads ${show(f.name)}`;
}

function define(f, descriptor) {
  try {
    Object.defineProperty(f, "name", descriptor);
    return "defined";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}

// As in node:fs.
function setName(f, value) {
  Object.defineProperty(f, "name", { value, enumerable: false, configurable: true });
}

// The function is named by its binding where its name is defined and where it is read.
function Kept() { this.made = true; throw new Error("Kept"); }
Object.defineProperty(Kept, "name", { value: "Kept", enumerable: false, configurable: true });
console.log(`the name it has: frame ${topFrame(() => new Kept())}, reads ${show(Kept.name)}, bound ${show(Kept.bind(null).name)}, ${everything(Kept)}`);

function Changed() { this.made = true; throw new Error("Changed"); }
Object.defineProperty(Changed, "name", { value: "another", enumerable: false, configurable: true });
console.log(`another name: frame ${topFrame(() => new Changed())}, reads ${show(Changed.name)}, bound ${show(Changed.bind(null).name)}, ${everything(Changed)}`);

function Unlocked() { this.made = true; throw new Error("Unlocked"); }
Object.defineProperty(Unlocked, "name", { value: "Unlocked", writable: true });
console.log(`the name it has, writable: frame ${topFrame(() => new Unlocked())}, reads ${show(Unlocked.name)}, ${everything(Unlocked)}`);
Unlocked.name = "stored";
console.log(`the name it has, writable, then a store: reads ${show(Unlocked.name)}, bound ${show(Unlocked.bind(null).name)}, ${everything(Unlocked)}`);

function Removed() { this.made = true; throw new Error("Removed"); }
delete Removed.name;
console.log(`after delete: frame ${topFrame(() => new Removed())}, reads ${show(Removed.name)}, ${everything(Removed)}`);
Object.defineProperty(Removed, "name", { value: "Removed", enumerable: false, configurable: true });
console.log(`the name it had, after delete: frame ${topFrame(() => new Removed())}, reads ${show(Removed.name)}, ${everything(Removed)}`);

// Several names in turn, for functions that have one function object in the whole program.
// The frame of a function that is only called has the name that the function had at the build, so its frames are not asked for once the name has changed.
function declared() { throw new Error("declared"); }
function targeted() { if (!new.target) throw new Error("targeted"); }
function Constructed() { this.made = true; throw new Error("Constructed"); }
class Shape { constructor() { throw new Error("Shape"); } }
for (const [what, f, own, run, isConstructed] of [
  ["a declaration", declared, "declared", declared, false],
  ["a declaration that reads new.target", targeted, "targeted", targeted, false],
  ["a function that is constructed", Constructed, "Constructed", () => new Constructed(), true],
  ["a class", Shape, "Shape", () => new Shape(), true],
]) {
  const frames = [topFrame(run)];
  for (const name of [own, own, "another", own, "third"]) {
    setName(f, name);
    if (isConstructed) frames.push(topFrame(run));
  }
  console.log(`${what}, several names in turn: frames ${frames.join(", ")}, ${everything(f)}`);
}

// One definition for each function.
function oneDefinition(what, f, name, run) {
  const before = topFrame(run);
  setName(f, name);
  console.log(`${what} defined as ${show(name)}: frame ${before}, then ${topFrame(run)}, ${everything(f)}, frame ${topFrame(run)}`);
}

const literal = {
  kept() { throw new Error("kept"); },
  changed() { throw new Error("changed"); },
  *keptItems() { throw new Error("keptItems"); },
  *changedItems() { throw new Error("changedItems"); },
  get keptTotal() { throw new Error("keptTotal"); },
  get changedTotal() { throw new Error("changedTotal"); },
  set keptLimit(value) { throw new Error("keptLimit"); },
  set changedLimit(value) { throw new Error("changedLimit"); },
};
class Members {
  kept() { throw new Error("kept"); }
  changed() { throw new Error("changed"); }
  static keptStatic() { throw new Error("keptStatic"); }
  static changedStatic() { throw new Error("changedStatic"); }
}
const keptArrow = () => { throw new Error("keptArrow"); };
const changedArrow = () => { throw new Error("changedArrow"); };
const keptExpression = function () { throw new Error("keptExpression"); };
const changedExpression = function () { throw new Error("changedExpression"); };
function* keptGenerator() { throw new Error("keptGenerator"); }
function* changedGenerator() { throw new Error("changedGenerator"); }
function target() { throw new Error("target"); }
const keptBound = target.bind(null);
const changedBound = target.bind(null);

oneDefinition("a method of a literal", literal.kept, "kept", () => literal.kept());
oneDefinition("a method of a literal", literal.changed, "another", () => literal.changed());
oneDefinition("a generator method", literal.keptItems, "keptItems", () => literal.keptItems().next());
oneDefinition("a generator method", literal.changedItems, "another", () => literal.changedItems().next());
oneDefinition("a getter", Object.getOwnPropertyDescriptor(literal, "keptTotal").get, "get keptTotal", () => literal.keptTotal);
oneDefinition("a getter", Object.getOwnPropertyDescriptor(literal, "changedTotal").get, "another", () => literal.changedTotal);
oneDefinition("a setter", Object.getOwnPropertyDescriptor(literal, "keptLimit").set, "set keptLimit", () => { literal.keptLimit = 1; });
oneDefinition("a setter", Object.getOwnPropertyDescriptor(literal, "changedLimit").set, "another", () => { literal.changedLimit = 1; });
oneDefinition("a method of a class", Members.prototype.kept, "kept", () => new Members().kept());
oneDefinition("a method of a class", Members.prototype.changed, "another", () => new Members().changed());
oneDefinition("a static method", Members.keptStatic, "keptStatic", () => Members.keptStatic());
oneDefinition("a static method", Members.changedStatic, "another", () => Members.changedStatic());
oneDefinition("an arrow function in a variable", keptArrow, "keptArrow", keptArrow);
oneDefinition("an arrow function in a variable", changedArrow, "another", changedArrow);
oneDefinition("a function expression in a variable", keptExpression, "keptExpression", keptExpression);
oneDefinition("a function expression in a variable", changedExpression, "another", changedExpression);
oneDefinition("a generator", keptGenerator, "keptGenerator", () => keptGenerator().next());
oneDefinition("a generator", changedGenerator, "another", () => changedGenerator().next());
oneDefinition("a bound function", keptBound, "bound target", keptBound);
oneDefinition("a bound function", changedBound, "another", changedBound);

const tag = Symbol("tag");
const computedKey = ["com", "puted"].join("");
let ticks = 0;
const capture = make => make(++ticks, ++ticks, ++ticks, ++ticks, ++ticks, ++ticks);

// Every call creates a new function object. One that is named after a variable is used twice: plain Bun's transpiler puts a constant that is used once in the place of its use, where the function gets no name.
let lastMade;
const kinds = {
  "a function that is only called": () => function called() {},
  "a function that is constructed": () => {
    function Built() { this.made = true; }
    new Built();
    return Built;
  },
  "a function that reads new.target": () => function aware() { return new.target; },
  "a function with six captures": () => capture((a, b, c, d, e, g) => function summed() { return a + b + c + d + e + g; }),
  "a function expression in a variable": () => {
    const inferred = function () {};
    lastMade = inferred;
    return inferred;
  },
  "a function without a name": () => function () {},
  "an arrow function in a variable": () => {
    const pointed = () => {};
    lastMade = pointed;
    return pointed;
  },
  "an arrow function with six captures": () =>
    capture((a, b, c, d, e, g) => {
      const adding = () => a + b + c + d + e + g;
      lastMade = adding;
      return adding;
    }),
  "a generator": () => function* yielding() {},
  "a generator in a variable": () => {
    const stepping = function* () {};
    lastMade = stepping;
    return stepping;
  },
  "a generator without a name": () => function* () {},
  "a generator whose name is not ASCII": () => function* café() {},
  "a generator whose name is not Latin-1": () => function* 名前() {},
  "an async function": () => async function awaited() {},
  "an async generator": () => async function* streamed() {},
  "a method of a literal": () => ({ run() {} }).run,
  "a generator method": () => ({ *walk() {} }).walk,
  "a method of a class": () => (class { area() {} }).prototype.area,
  "a static method": () => (class { static make() {} }).make,
  "a method with a computed key": () => ({ [computedKey]() {} })[computedKey],
  "a method with a symbol key": () => ({ [tag]() {} })[tag],
  "a getter": () => Object.getOwnPropertyDescriptor({ get total() { return 0; } }, "total").get,
  "a getter with six captures": () => capture((a, b, c, d, e, g) => Object.getOwnPropertyDescriptor({ get sum() { return a + b + c + d + e + g; } }, "sum").get),
  "a setter": () => Object.getOwnPropertyDescriptor({ set limit(value) {} }, "limit").set,
  "an arrow function in a class field": () => new (class { handler = () => {}; })().handler,
  "a class": () => class Circle {},
  "a class in a variable": () => {
    const Square = class {};
    lastMade = Square;
    return Square;
  },
  "a class with a static field called name": () => class Labeled { static name = "given"; },
  "a bound function": () => function aimed() {}.bind(null),
};

const definitions = {
  "as node:fs does it": own => ({ value: own, enumerable: false, configurable: true }),
  "the value alone": own => ({ value: own }),
  "every attribute as it is": own => ({ value: own, writable: false, enumerable: false, configurable: true }),
  "a value put together at run time": own => ({ value: own.slice(0, 1) + own.slice(1) }),
  "a value cut out of a 16-bit string": own => ({ value: `☃${own}☃`.slice(1, -1) }),
  "writable": own => ({ value: own, writable: true }),
  "enumerable": own => ({ value: own, enumerable: true }),
  "not configurable": own => ({ value: own, configurable: false }),
  "a longer value": own => ({ value: own + "2" }),
  "all but the last character": own => ({ value: own.slice(0, -1) }),
  "the empty string": () => ({ value: "" }),
  "a String object": own => ({ value: new String(own) }),
  "a number": () => ({ value: 7 }),
  "undefined": () => ({ value: undefined }),
  "attributes alone": () => ({ enumerable: false, configurable: true }),
  "an empty descriptor": () => ({}),
  "a getter": own => ({ get: () => own }),
};

const states = {
  "after a read of its name": f => void f.name,
  "after a read of its length and prototype": f => void [f.length, f.prototype],
  "after its own names were listed": f => void Object.getOwnPropertyNames(f),
  "after the same definition": (f, own) => setName(f, own),
  "after another name": f => setName(f, "another"),
  "after delete": f => void Reflect.deleteProperty(f, "name"),
  "after the same definition and delete": (f, own) => {
    setName(f, own);
    Reflect.deleteProperty(f, "name");
  },
  "with another property": f => void (f.extra = 1),
  "not extensible": f => void Object.preventExtensions(f),
  "not extensible, after delete": f => {
    Object.preventExtensions(f);
    Reflect.deleteProperty(f, "name");
  },
  "sealed": f => void Object.seal(f),
  "frozen": f => void Object.freeze(f),
};

// Each is the first thing that happens to a function object after the definition.
const questions = {
  "its property": f => nameProperty(f),
  "its own names": f => withPrototypeLast(Object.getOwnPropertyNames(f)).join(),
  "its own keys": f => withPrototypeLast(Reflect.ownKeys(f).map(String)).join(),
  "its enumerable names": f => Object.keys(f).join() || "none",
  "a read": f => show(f.name),
  "hasOwn": f => String(Object.hasOwn(f, "name")),
  "a store": f => `${Reflect.set(f, "name", "stored")}, ${everything(f)}`,
  "delete": f => `${Reflect.deleteProperty(f, "name")}, ${everything(f)}`,
  "delete, then bind": f => `${Reflect.deleteProperty(f, "name")}, ${show(f.bind(null).name)}`,
  "bind": f => show(f.bind(null).name),
  "another name": f => `${define(f, { value: "another" })}, ${everything(f)}`,
  "another name, then bind": f => `${define(f, { value: "another" })}, ${show(f.bind(null).name)}`,
  "writable, then a store": f => `${define(f, { writable: true })}, ${Reflect.set(f, "name", "stored")}, ${everything(f)}`,
  "not configurable, then the same definition": (f, own) =>
    `${define(f, { configurable: false })}, ${define(f, { value: own, enumerable: false, configurable: true })}, ${define(f, { value: own })}, ${everything(f)}`,
  "freeze, then the same definition": (f, own) =>
    `${Object.isFrozen(Object.freeze(f))}, ${define(f, { value: own, enumerable: false, configurable: true })}, ${define(f, { value: own })}, ${everything(f)}`,
};

const ways = {
  "Reflect.defineProperty": (f, descriptor) => Reflect.defineProperty(f, "name", descriptor),
  "Object.defineProperties": (f, descriptor) => Object.defineProperties(f, { name: descriptor }) === f,
  "a key put together at run time": (f, descriptor) => Reflect.defineProperty(f, ["na", "me"].join(""), descriptor),
  "a descriptor that inherits its members": (f, descriptor) => Reflect.defineProperty(f, "name", Object.create(descriptor)),
  "a proxy without traps": (f, descriptor) => Reflect.defineProperty(new Proxy(f, {}), "name", descriptor),
  "a proxy that passes it on": (f, descriptor) =>
    Reflect.defineProperty(new Proxy(f, { defineProperty: (inner, key, passed) => Reflect.defineProperty(inner, key, passed) }), "name", descriptor),
};

for (const [kind, create] of Object.entries(kinds)) {
  const own = create().name;
  for (const [definition, describe] of Object.entries(definitions)) {
    const f = create();
    console.log(`${kind}, ${definition}: ${define(f, describe(own))}, ${everything(f)}`);
  }
  for (const [state, prepare] of Object.entries(states)) {
    for (const definition of ["as node:fs does it", "the value alone"]) {
      const f = create();
      prepare(f, own);
      console.log(`${kind}, ${state}, ${definition}: ${define(f, definitions[definition](own))}, ${everything(f)}`);
    }
  }
  for (const [question, ask] of Object.entries(questions)) {
    const f = create();
    setName(f, own);
    console.log(`${kind}, the same definition, then ${question}: ${ask(f, own)}`);
  }
  for (const [way, apply] of Object.entries(ways)) {
    const f = create();
    console.log(`${kind}, through ${way}: ${apply(f, { value: own, enumerable: false, configurable: true })}, ${everything(f)}`);
  }
  const [first, second, third] = [create(), create(), create()];
  setName(first, own);
  setName(second, "another");
  console.log(`${kind}, three function objects: ${[first, second, third].map(f => show(f.name)).join()}`);
}

function Repeated() { this.made = true; }
for (let i = 0; i < 10000; i++) setName(Repeated, "Repeated");
console.log(`the same definition 10000 times: ${everything(Repeated)}, makes ${show(new Repeated().constructor.name)}`);

let wrong = 0;
for (let i = 0; i < 10000; i++) {
  const each = function* () {};
  setName(each, "each");
  if (i % 3 === 0) setName(each, "each" + i);
  if (each.name !== (i % 3 === 0 ? "each" + i : "each")) wrong++;
}
console.log(`function objects with a wrong name among 10000: ${wrong}`);
