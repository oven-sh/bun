// Getters and setters in object literals and classes: their position in the key order, and the names of functions with computed keys. A second getter of the same name keeps the place of the first, as ECMAScript says; in plain Bun it moves to the end.
const lines = [];
function say(label, value) {
  lines.push(label + ": " + value);
}
function keyText(key) {
  return typeof key === "symbol" ? key.toString() : JSON.stringify(key);
}
function flagsOf(descriptor) {
  return (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
}
function describeKey(object, key) {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  const body = "value" in descriptor ? (typeof descriptor.value === "function" ? "function" : String(descriptor.value)) : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
  return keyText(key) + " " + flagsOf(descriptor) + " " + body;
}
function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => describeKey(object, key))
    .join(", ");
}
function keysInLoop(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  return keys.join();
}
function report(label, object) {
  say(label, [Object.keys(object).join(), keysInLoop(object), JSON.stringify(object), describe(object)].join(" | "));
}

const tag = Symbol("tag");

function pair(i) {
  return { a: i, get b() { return this.a + 1; }, c: i + 2, set b(value) { this.a = value; } };
}
report("a getter and its setter around a value", pair(1));
const stored = pair(1);
stored.b = 10;
report("after the setter ran", stored);

function five(i) {
  return {
    start: i,
    get one() { return this.start + 1; },
    get two() { return this.start + 2; },
    middle: i * 2,
    set three(value) { this.start = value; },
    get four() { return this.start + 4; },
    get five() { return this.start + 5; },
    end: i * 3,
  };
}
report("five accessors in one literal", five(1));

report("only accessors", { get a() { return 1; }, set b(value) {}, get c() { return 3; } });
report("a value after a getter of the same name", { first: 0, get a() { return "getter"; }, between: 1, a: "value", last: 2 });
report("a getter after a value of the same name", { first: 0, a: "value", between: 1, get a() { return "getter"; }, last: 2 });
report("a setter, a value, a getter", { set a(value) {}, b: 0, a: "value", c: 1, get a() { return "getter"; } });
report("two getters of the same name", { get a() { return "first"; }, b: 0, get a() { return "second"; } });
report("the setter first", { set a(value) {}, b: 0, get a() { return "getter"; } });
report("a method after an accessor of the same name", { get a() { return "getter"; }, b: 0, a() {} });
report("indexes, numbers, strings and a symbol as names", {
  z: 0,
  get 1() { return "one"; },
  get 0() { return "zero"; },
  get 1.5() { return "one and a half"; },
  get "quoted name"() { return "quoted"; },
  get [tag]() { return "symbol"; },
  a: 1,
});
const namedProto = { get __proto__() { return "own"; }, a: 1 };
report("an accessor named __proto__", namedProto);
say("the prototype is unchanged", Object.getPrototypeOf(namedProto) === Object.prototype);

function computed(key, i) {
  return { a: i, get [key]() { return "got " + i; }, b: i + 1, set [key](value) { this.received = value; }, c: i + 2 };
}
for (const key of ["k", "a", "c", 0, "0", tag, "__proto__"]) report("computed accessors, " + keyText(key), computed(key, 1));

const first = { x: 1, middle: "from the first spread" };
const second = { y: 2, middle: "from the second spread" };
report("a getter between spreads", { ...first, get middle() { return "getter"; }, ...{ y: 2 }, z: 3 });
report("a spread over a getter", { get middle() { return "getter"; }, ...second, z: 3 });
report("a setter after a spread over a getter", { get middle() { return "getter"; }, ...second, set middle(value) {} });
report("a getter and a setter with a spread between them", { get middle() { return "getter"; }, ...{ y: 2 }, set middle(value) {} });
report("a spread of an object with accessors", { before: 0, ...pair(1), after: 1 });

const names = ["k", "longer name", "a"];
const orders = new Set();
let total = 0;
for (let i = 0; i < 100; i++) {
  const wide = five(i);
  wide.three = i + 1;
  const narrow = pair(i);
  narrow.b = i * 2;
  const keyed = computed(names[i % names.length], i);
  total += wide.one + wide.two + wide.four + wide.five + wide.middle + wide.end + narrow.b + narrow.c + keyed[names[i % names.length]].length + keyed.b;
  orders.add([Object.keys(wide).join(), Object.keys(narrow).join(), Object.keys(keyed).join()].join(" ; "));
}
say("100 of each", total + " | " + [...orders].join(" / "));

const removed = pair(1);
delete removed.b;
removed.b = "again";
report("an accessor deleted and its name assigned", removed);
const extended = pair(1);
extended.d = 4;
Object.defineProperty(extended, "e", { get() { return 5; }, enumerable: true });
Object.defineProperty(extended, "b", { enumerable: false });
report("properties added after the literal, and the accessor changed to non-enumerable", extended);
report("frozen", Object.freeze(pair(1)));

class Shape {
  constructor(side) {
    this.side = side;
  }
  get area() {
    return this.side * this.side;
  }
  set area(value) {
    this.side = Math.sqrt(value);
  }
  get [tag]() {
    return "tagged";
  }
  set ["comp" + "uted"](value) {
    this.side = value;
  }
  static get unit() {
    return new Shape(1);
  }
  static set ["comp" + "uted"](value) {}
}
say("accessors of a class", describe(Shape.prototype) + " | " + describeKey(Shape, "unit") + ", " + describeKey(Shape, "computed"));
const shape = new Shape(2);
shape.area = 9;
shape.computed = shape.side + 1;
report("an instance of it", shape);
say("its inherited accessors", [shape.area, shape[tag], Shape.unit.area].join());

function nameOf(callable) {
  const descriptor = Reflect.getOwnPropertyDescriptor(callable, "name");
  if (!descriptor) return "no own name";
  if (!("value" in descriptor)) return flagsOf(descriptor) + " an accessor that returns " + JSON.stringify(callable.name);
  return flagsOf(descriptor) + " " + (typeof descriptor.value === "function" ? "a method" : JSON.stringify(descriptor.value));
}
function namesOfAccessor(object, key) {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  return (descriptor.get ? nameOf(descriptor.get) : "no getter") + ", " + (descriptor.set ? nameOf(descriptor.set) : "no setter");
}

const key = "computed";
const described = Symbol("description");
const functions = {
  [key + "Method"]() {},
  async [key + "Async"]() {},
  *[key + "Generator"]() {},
  async *[key + "AsyncGenerator"]() {},
  [key + "Arrow"]: () => {},
  [key + "Function"]: function () {},
  [key + "Class"]: class {},
  [key + "NamedFunction"]: function own() {},
  [key + "NamedClass"]: class Own {},
  [key + " with spaces"]: () => {},
  [""]: function () {},
  [1 + 1]() {},
  [1.5]: function () {},
  [described]() {},
  [Symbol("arrow description")]: () => {},
  [Symbol("class description")]: class {},
  [Symbol("")]() {},
  [Symbol()]() {},
  [Symbol.iterator]() {},
};
for (const name of Reflect.ownKeys(functions)) say("the function under " + keyText(name), nameOf(functions[name]));

const accessors = {
  get [key + "Getter"]() { return 1; },
  set [key + "Setter"](value) {},
  get [key + "Both"]() { return 1; },
  set [key + "Both"](value) {},
  get [described]() { return 1; },
  set [described](value) {},
  get [Symbol()]() { return 1; },
  get [3]() { return 1; },
};
for (const name of Reflect.ownKeys(accessors)) say("the accessor under " + keyText(name), namesOfAccessor(accessors, name));

const classes = {
  [key + "StaticMethod"]: class { static name() {} },
  [key + "StaticGetter"]: class { static get name() { return "from the getter"; } },
  [key + "StaticField"]: class { static name = "from the field"; },
  [key + "StaticComputedField"]: class { static ["na" + "me"] = "from the computed field"; },
  [key + "StaticComputedMethod"]: class { static ["na" + "me"]() {} },
  [key + "OtherStatics"]: class { static label = "label"; static length = 5; },
  [key + "Derived"]: class extends Shape {},
};
for (const name of Reflect.ownKeys(classes)) say("the class under " + keyText(name), nameOf(classes[name]));

class Members {
  [key + "Method"]() {}
  static [key + "Static"]() {}
  get [key + "Getter"]() { return 1; }
  static set [key + "Setter"](value) {}
  [described]() {}
  [key + "Field"] = () => {};
  [key + "FunctionField"] = function () {};
  [key + "ClassField"] = class {};
  [key + "NamedField"] = function own() {};
  [Symbol.for("field description")] = () => {};
  static [key + "StaticField"] = () => {};
  plainField = () => {};
}
const members = new Members();
say("members of a class with computed names", [
  nameOf(Members.prototype[key + "Method"]),
  nameOf(Members[key + "Static"]),
  namesOfAccessor(Members.prototype, key + "Getter"),
  namesOfAccessor(Members, key + "Setter"),
  nameOf(Members.prototype[described]),
  nameOf(members[key + "Field"]),
  nameOf(members[key + "FunctionField"]),
  nameOf(members[key + "ClassField"]),
  nameOf(members[key + "NamedField"]),
  nameOf(members[Symbol.for("field description")]),
  nameOf(Members[key + "StaticField"]),
  nameOf(members.plainField),
].join(" | "));

function methodUnder(name) {
  return { [name]() {} }[name];
}
function getterUnder(name) {
  return Reflect.getOwnPropertyDescriptor({ get [name]() { return 1; } }, name).get;
}
function arrowUnder(name) {
  return { [name]: () => {} }[name];
}
function classUnder(name) {
  return { [name]: class {} }[name];
}
for (const [label, create] of [["method", methodUnder], ["getter", getterUnder], ["arrow function", arrowUnder], ["class", classUnder]]) {
  const created = [];
  for (let i = 0; i < 100; i++) created.push(create(i % 10 ? "n" + (i % 10) : described));
  say("100 closures of one " + label, [...new Set(created.map(callable => callable.name))].join() + " | " + created[0].name + " " + created[1].name + " " + created[99].name);
}

report("no accessors", { a: 1, b: 2, c: 3 });
report("no accessors, a computed key", { a: 1, ["b"]: 2, c: 3 });
report("no accessors, a method", { a: 1, b() {}, c: 3 });
const written = { method() {}, arrow: () => {}, expression: function () {}, named: function own() {}, "quoted name"() {}, 7() {}, get getter() { return 1; }, set setter(value) {} };
say("names that are not computed", ["method", "arrow", "expression", "named", "quoted name", "7"].map(name => nameOf(written[name])).join(" | ") + " | " + namesOfAccessor(written, "getter") + " | " + namesOfAccessor(written, "setter"));

console.log(lines.join("\n"));
