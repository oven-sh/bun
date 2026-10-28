// Objects that are given their names one by one, by code that runs once: prototype objects, functions, what Object.create and JSON.parse make. Then the same names in the same order for a second and a third object.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
function describe(label, object) {
  const names = Object.getOwnPropertyNames(object);
  say(label, JSON.stringify(names), JSON.stringify(Object.keys(object)));
  for (const name of names) {
    const { value, get, set, ...flags } = Object.getOwnPropertyDescriptor(object, name);
    say(" ", name, typeof value, typeof get, typeof set, JSON.stringify(flags));
  }
}
function inherited(object) {
  const names = [];
  for (const name in object) names.push(name);
  return names.join(",");
}

function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function () {
  return this.name + " speaks";
};
Animal.prototype.walk = function () {
  return this.name + " walks";
};
const early = new Animal("early");
say(early.speak(), early.walk(), typeof early.swim, inherited(early));
Animal.prototype.swim = function () {
  return this.name + " swims";
};
Animal.prototype.legs = 4;
Object.defineProperty(Animal.prototype, "hidden", { value: 1, writable: true, configurable: true });
Object.defineProperty(Animal.prototype, "loud", {
  enumerable: true,
  configurable: true,
  get() {
    return this.speak().toUpperCase();
  },
});
Animal.prototype.fly = function () {
  return this.name + " flies";
};
say(early.swim(), early.legs, early.hidden, early.loud, early.fly(), inherited(early));
describe("Animal.prototype", Animal.prototype);
Animal.prototype.walk = function () {
  return this.name + " strolls";
};
delete Animal.prototype.swim;
Animal.prototype.swim = function () {
  return this.name + " dives";
};
say(early.walk(), early.swim(), inherited(early), Object.keys(Animal.prototype).join());

function helper(value) {
  return value;
}
helper.version = "1.0";
helper.create = function () {
  return helper;
};
helper.defaults = { a: 1 };
helper.extend = function (more) {
  return { ...helper.defaults, ...more };
};
Object.defineProperty(helper, "name", { value: "renamed" });
helper.last = true;
describe("helper", helper);
say(helper.create() === helper, JSON.stringify(helper.extend({ b: 2 })), helper.name, helper.length, "prototype" in helper);

const table = Object.create(null);
table.zero = 0;
table.one = 1;
table.two = 2;
table["three"] = 3;
table[["fo", "ur"].join("")] = 4;
say(JSON.stringify(table), Object.keys(table).join(), "one" in table, "five" in table, JSON.stringify({ ...table }), JSON.stringify(Object.assign({}, table)));

const above = {};
Object.defineProperty(above, "caught", {
  configurable: true,
  set(value) {
    say("the setter above got", value, "for", typeof this);
  },
});
Object.defineProperty(above, "fixed", { configurable: true, value: 0 });
const below = Object.create(above);
below.first = 1;
below.caught = 2;
below.fixed = 3;
below.second = 4;
function Caught() {}
Object.setPrototypeOf(Caught.prototype, above);
Caught.prototype.first = 1;
Caught.prototype.caught = 5;
Caught.prototype.second = 2;
Object.setPrototypeOf(Caught, above);
Caught.first = 1;
Caught.caught = 6;
Caught.second = 2;
delete above.caught;
delete above.fixed;
below.caught = 7;
below.fixed = 8;
say(JSON.stringify(below), Object.keys(Caught.prototype).join(), Object.keys(Caught).join());

function fill(object, round) {
  object.id = round;
  object.label = "n" + round;
  object.flags = round % 2 === 0;
  object.next = null;
  return object;
}
const filled = [];
for (let round = 0; round < 6; round++) filled.push(fill(JSON.parse("{}"), round));
say(JSON.stringify(filled), filled.map(object => Object.keys(object).join()).join(" "));

const wide = JSON.parse("{}");
for (let index = 0; index < 100; index++) wide["k" + index] = index;
wide.behind = true;
let sum = 0;
for (const name in wide) sum += Number(wide[name]);
say(Object.keys(wide).length, sum, Object.keys(wide).slice(-2).join());

const sealed = JSON.parse("{}");
sealed.a = 1;
sealed.b = 2;
Object.seal(sealed);
sealed.c = 3;
sealed.a = 4;
say(JSON.stringify(sealed), Object.isSealed(sealed), delete sealed.b);
const frozen = Object.create({ above: 1 });
frozen.a = 1;
frozen.b = 2;
Object.freeze(frozen);
frozen.a = 5;
frozen.c = 6;
say(JSON.stringify(frozen), Object.isFrozen(frozen), frozen.above, inherited(frozen));
class InStrictCode {
  static stores() {
    return [() => (frozen.a = 7), () => (frozen.d = 8), () => (sealed.d = 9), () => (sealed.a = 10)];
  }
}
for (const store of InStrictCode.stores()) {
  try {
    say("stored", store());
  } catch (error) {
    say(error.constructor.name);
  }
}

const many = [];
for (let index = 0; index < 40; index++) {
  const object = JSON.parse("{}");
  object["only" + index] = index;
  object["also" + index] = index;
  object["more" + index] = index;
  many.push(object);
  if (index % 10 === 9 && typeof Bun !== "undefined") Bun.gc(true);
}
for (const object of many) object.late = Object.keys(object).length;
say(many.map(object => Object.keys(object).join("+") + "=" + object.late).join(" "));

function Base() {}
Base.prototype.kind = function () {
  return "base";
};
Base.prototype.shared = function () {
  return "shared by " + this.kind();
};
function Derived() {}
Derived.prototype = Object.create(Base.prototype);
Derived.prototype.constructor = Derived;
Derived.prototype.kind = function () {
  return "derived";
};
Derived.prototype.own = function () {
  return "own of " + this.kind();
};
const derived = new Derived();
for (let round = 0; round < 4; round++) say(derived.kind(), derived.shared(), derived.own(), derived instanceof Base, inherited(derived));
Base.prototype.late = function () {
  return "late for " + this.kind();
};
say(derived.late(), new Base().late(), inherited(derived));

console.log(lines.join("\n"));
