// Private members on objects nothing is known about, in loops long enough to fill the keyed tables.
function describeOutcome(f) {
  try {
    return String(f());
  } catch (e) {
    return "threw " + e.name;
  }
}
function collectOutcomes(f) {
  const results = new Set();
  for (let i = 0; i < 100; i++) results.add(describeOutcome(f));
  return [...results].join(" / ");
}
function show(...parts) {
  console.log(parts.join(" | "));
}

class Identity {
  constructor(target) {
    return target;
  }
}

class Stamp extends Identity {
  #field = 1;
  #method() {
    return "method " + this.#field;
  }
  get #getter() {
    return "getter " + this.#field;
  }
  set #setter(value) {
    this.#field = value;
  }
  get #both() {
    return this.#field * 2;
  }
  set #both(value) {
    this.#field = value / 2;
  }
  static #staticField = 10;
  static #staticMethod() {
    return "static method";
  }
  static get #staticAccessor() {
    return Stamp.#staticField + 1;
  }
  static set #staticAccessor(value) {
    Stamp.#staticField = value;
  }

  static readField(o) {
    return o.#field;
  }
  static writeField(o, value) {
    o.#field = value;
    return o.#field;
  }
  static callMethod(o) {
    return o.#method();
  }
  static writeMethod(o) {
    o.#method = 1;
  }
  static readGetter(o) {
    return o.#getter;
  }
  static writeGetter(o) {
    o.#getter = 1;
  }
  static readSetter(o) {
    return o.#setter;
  }
  static writeSetter(o, value) {
    o.#setter = value;
    return o.#field;
  }
  static readBoth(o) {
    return o.#both;
  }
  static writeBoth(o, value) {
    o.#both = value;
    return o.#both;
  }
  static hasField(o) {
    return #field in o;
  }
  static hasMethod(o) {
    return #method in o;
  }
  static hasGetter(o) {
    return #getter in o;
  }
  static readStatic(o) {
    return o.#staticField;
  }
  static writeStatic(o, value) {
    o.#staticField = value;
    return o.#staticField;
  }
  static callStatic(o) {
    return o.#staticMethod();
  }
  static readStaticAccessor(o) {
    return o.#staticAccessor;
  }
  static writeStaticAccessor(o, value) {
    o.#staticAccessor = value;
    return o.#staticAccessor;
  }
  static hasStatic(o) {
    return #staticField in o;
  }
}

class Fields extends Identity {
  #value = "field";
  static read(o) {
    return o.#value;
  }
  static has(o) {
    return #value in o;
  }
}

class Methods extends Identity {
  #method() {
    return "only a method";
  }
  static call(o) {
    return o.#method();
  }
  static has(o) {
    return #method in o;
  }
}

class Plain {
  #field = "own";
  #method() {
    return this.#field + " method";
  }
  get #accessor() {
    return this.#field + " accessor";
  }
  set #accessor(value) {
    this.#field = value;
  }
  static describe(o) {
    o.#accessor = o.#field + "!";
    return [o.#field, o.#method(), o.#accessor, #field in o, #method in o, #accessor in o].join();
  }
}

const trapped = [];
const proxyTarget = {};
const traps = {};
for (const name of ["get", "set", "has", "defineProperty", "getOwnPropertyDescriptor", "deleteProperty", "ownKeys"]) {
  traps[name] = (...args) => {
    trapped.push(name);
    return Reflect[name](...args);
  };
}
const proxy = new Proxy(proxyTarget, traps);
const frozenFirst = Object.freeze({ shown: 1 });
const frozenLater = { shown: 2 };
const dictionary = {};
for (let i = 0; i < 200; i++) dictionary["key" + i] = i;
for (let i = 0; i < 190; i++) delete dictionary["key" + i];

const stamped = [
  ["plain", {}],
  ["with properties", { a: 1, b: 2 }],
  ["array", []],
  ["function", function () {}],
  ["frozen first", frozenFirst],
  ["frozen later", frozenLater],
  ["dictionary", dictionary],
  ["proxy", proxy],
];
for (const [, target] of stamped) new Stamp(target);
Object.freeze(frozenLater);

for (const [title, o] of stamped) {
  show(
    title,
    collectOutcomes(() => Stamp.readField(o)),
    collectOutcomes(() => Stamp.callMethod(o)),
    collectOutcomes(() => Stamp.readGetter(o)),
    collectOutcomes(() => Stamp.readBoth(o)),
    collectOutcomes(() => [Stamp.hasField(o), Stamp.hasMethod(o), Stamp.hasGetter(o), Stamp.hasStatic(o)]),
  );
  let total = 0;
  for (let i = 0; i < 100; i++) total += Stamp.writeField(o, i);
  show(
    title + " writes",
    total,
    collectOutcomes(() => Stamp.writeSetter(o, 7)),
    collectOutcomes(() => Stamp.writeBoth(o, 8)),
    collectOutcomes(() => Stamp.writeMethod(o)),
    collectOutcomes(() => Stamp.writeGetter(o)),
    collectOutcomes(() => Stamp.readSetter(o)),
  );
}
show("proxy traps that ran", trapped.length, "target has the field", Stamp.hasField(proxyTarget));
show("frozen objects stay frozen", Object.isFrozen(frozenFirst), Object.isFrozen(frozenLater));

const inherited = Object.create(stamped[0][1]);
const absent = [
  ["no members", {}],
  ["inherits them", inherited],
  ["frozen", Object.freeze({})],
  ["proxy of a stamped object", new Proxy(stamped[0][1], {})],
  ["prototype", Stamp.prototype],
];
for (const [title, o] of absent) {
  show(
    title,
    collectOutcomes(() => Stamp.readField(o)),
    collectOutcomes(() => Stamp.writeField(o, 1)),
    collectOutcomes(() => Stamp.callMethod(o)),
    collectOutcomes(() => Stamp.readGetter(o)),
    collectOutcomes(() => Stamp.writeSetter(o, 1)),
    collectOutcomes(() => [Stamp.hasField(o), Stamp.hasMethod(o), Stamp.hasGetter(o)]),
  );
}

for (const [title, value] of [["number", 5], ["string", "text"], ["boolean", true], ["symbol", Symbol.iterator], ["bigint", 5n], ["null", null], ["undefined", undefined]]) {
  show(
    title,
    collectOutcomes(() => Stamp.readField(value)),
    collectOutcomes(() => Stamp.writeField(value, 1)),
    collectOutcomes(() => Stamp.callMethod(value)),
    collectOutcomes(() => Stamp.hasField(value)),
    collectOutcomes(() => Stamp.hasMethod(value)),
  );
}

show(
  "static members",
  collectOutcomes(() => Stamp.readStatic(Stamp)),
  collectOutcomes(() => Stamp.callStatic(Stamp)),
  collectOutcomes(() => Stamp.readStaticAccessor(Stamp)),
  collectOutcomes(() => Stamp.hasStatic(Stamp)),
);
let staticTotal = 0;
for (let i = 0; i < 100; i++) staticTotal += Stamp.writeStatic(Stamp, i) + Stamp.writeStaticAccessor(Stamp, i);
show("static writes", staticTotal);
class Derived extends Stamp {}
show(
  "static members of a subclass",
  collectOutcomes(() => Stamp.readStatic(Derived)),
  collectOutcomes(() => Stamp.callStatic(Derived)),
  collectOutcomes(() => Stamp.readStaticAccessor(Derived)),
  collectOutcomes(() => Stamp.hasStatic(Derived)),
);

const twice = {};
new Fields(twice);
show("field added twice", describeOutcome(() => new Fields(twice)), Fields.read(twice));
const twiceFrozen = Object.freeze({});
new Fields(twiceFrozen);
show("field added twice to a frozen object", describeOutcome(() => new Fields(twiceFrozen)), Fields.read(twiceFrozen));
show(
  "field added over and over",
  collectOutcomes(() => new Fields(twice) === twice),
);
const sameShape = [];
for (let i = 0; i < 100; i++) sameShape.push(new Fields({ shape: i }));
show("fields added to one shape", sameShape.every(Fields.has), collectOutcomes(() => Fields.read(sameShape[99])));

const methodsTwice = {};
new Methods(methodsTwice);
show("methods installed twice", describeOutcome(() => new Methods(methodsTwice)), Methods.call(methodsTwice));
const methodsOnFrozen = Object.freeze({});
new Methods(methodsOnFrozen);
show("methods installed twice on a frozen object", describeOutcome(() => new Methods(methodsOnFrozen)), Methods.call(methodsOnFrozen));
show(
  "methods installed over and over",
  collectOutcomes(() => new Methods(methodsTwice) === methodsTwice),
);

const before = {};
const sameStructure = {};
show("absent brand", collectOutcomes(() => Methods.has(before)), collectOutcomes(() => Fields.has(before)));
new Methods(before);
show("brand after install", collectOutcomes(() => Methods.has(before)), collectOutcomes(() => Fields.has(before)));
show("brand of another object", collectOutcomes(() => Methods.has(sameStructure)));
new Fields(before);
show("field after install", collectOutcomes(() => Fields.has(before)), collectOutcomes(() => Fields.read(before)));
show("field of another object", collectOutcomes(() => Fields.has(sameStructure)), collectOutcomes(() => Fields.read(sameStructure)));

const reflected = {};
new Stamp(reflected);
show(
  "private members are not properties",
  Reflect.ownKeys(reflected).length,
  JSON.stringify(reflected),
  Object.getOwnPropertySymbols(reflected).length,
);

const instances = [];
for (let i = 0; i < 100; i++) instances.push(new Plain());
show("right class", new Set(instances.map(Plain.describe)).size, Plain.describe(instances[0]));
show("wrong class", collectOutcomes(() => Plain.describe({})), collectOutcomes(() => Plain.describe(new Stamp({}))));
const right = new Stamp({});
show(
  "right class through the helpers",
  collectOutcomes(() => Stamp.readField(right)),
  collectOutcomes(() => Stamp.callMethod(right)),
  collectOutcomes(() => Stamp.readGetter(right)),
  collectOutcomes(() => Stamp.writeSetter(right, 3)),
  collectOutcomes(() => Stamp.writeBoth(right, 4)),
  collectOutcomes(() => [Stamp.hasField(right), Stamp.hasMethod(right), Stamp.hasGetter(right)]),
);
