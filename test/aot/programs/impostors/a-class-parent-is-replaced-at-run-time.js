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

class Base {
  constructor(value) {
    this.fromBase = value;
  }
  greet() {
    return "base greets " + this.fromBase;
  }
  static make(value) {
    return new this(value);
  }
}

class Derived extends Base {
  constructor(value) {
    super(value);
    this.fromDerived = value;
  }
  greet() {
    return "derived, then " + super.greet();
  }
  static make(value) {
    return super.make(value);
  }
}

class Implicit extends Base {}

class Stranger {
  constructor(value) {
    this.fromStranger = value;
  }
  greet() {
    return "stranger greets " + this.fromStranger;
  }
  static make() {
    return "made by Stranger";
  }
}

function OldStranger(value) {
  this.fromOldStranger = value;
}
OldStranger.prototype.greet = function () {
  return "old stranger greets " + this.fromOldStranger;
};

function greet(thing) {
  return thing.greet();
}

function look(phase) {
  for (const Maker of [Derived, Implicit]) {
    attempt(phase + ", new " + Maker.name, () => new Maker(1));
    attempt(phase + ", new " + Maker.name + " greets", () => greet(new Maker(1)));
    attempt(phase + ", " + Maker.name + ".make", () => Maker.make(2));
    attempt(phase + ", instanceof Base, Stranger", () => [new Maker(1) instanceof Base, new Maker(1) instanceof Stranger]);
  }
}

let length = 0;
for (let i = 0; i < 2000; i++) length += greet(new Derived(i % 10)).length + greet(new Implicit(i % 10)).length + greet(Derived.make(1)).length;
console.log("2000 honest constructions", length);
look("untouched");

const constructorParents = [
  ["another class", Stranger],
  ["a constructor function", OldStranger],
  ["a function that returns a literal", function () { return { fromALiteral: true }; }],
  ["a bound Base", Base.bind(null, "bound")],
  ["a proxy that logs", new Proxy(Base, { construct(target, inputs, newTarget) { log.push("construct"); return Reflect.construct(target, inputs, newTarget); } })],
  ["Object", Object],
  ["Array", Array],
  ["Function.prototype", Function.prototype],
  ["an arrow function", () => {}],
  ["a plain object", {}],
  ["null", null],
];

for (const [label, parent] of constructorParents) {
  Object.setPrototypeOf(Derived, parent);
  Object.setPrototypeOf(Implicit, parent);
  look("the parent of the constructors is " + label);
}
Object.setPrototypeOf(Derived, Base);
Object.setPrototypeOf(Implicit, Base);
look("the constructors are back under Base");

for (const [label, parent] of [
  ["Stranger.prototype", Stranger.prototype],
  ["OldStranger.prototype", OldStranger.prototype],
  ["a literal", { greet() { return "a literal greets " + Object.keys(this).join(); } }],
  ["a literal without greet", {}],
  ["a literal with a setter for fromDerived", { set fromDerived(value) { log.push("set fromDerived " + value); }, greet() { return "under the setter"; } }],
  ["a frozen literal that has fromDerived", Object.freeze({ fromDerived: "fixed", greet() { return "under the frozen literal"; } })],
  ["null", null],
]) {
  Object.setPrototypeOf(Derived.prototype, parent);
  Object.setPrototypeOf(Implicit.prototype, parent);
  look("the parent of the prototypes is " + label);
}
Object.setPrototypeOf(Derived.prototype, Base.prototype);
Object.setPrototypeOf(Implicit.prototype, Base.prototype);
look("everything is back");
