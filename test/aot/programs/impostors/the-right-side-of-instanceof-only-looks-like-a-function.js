function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

class Animal {}
class Dog extends Animal {}

function Old() {}

function isA(value, type) {
  return value instanceof type;
}

function isAnAnimal(value) {
  return value instanceof Animal;
}

function honest(round) {
  console.log(round, isA(new Dog(), Animal), isA(new Animal(), Dog), isA({}, Object), isA([], Array), isA(new Old(), Old), isA(() => {}, Function), isA(1, Number), isA(null, Object));
  console.log(round, isAnAnimal(new Dog()), isAnAnimal(new Animal()), isAnAnimal({}), isAnAnimal(null), isAnAnimal(Object.create(Animal.prototype)));
}

const types = [
  ["a bound class", () => Animal.bind(null)],
  ["a class bound twice", () => Animal.bind(null).bind(null)],
  ["a proxy of the class", () => new Proxy(Animal, { get: (target, key) => (log.push("get " + String(key)), target[key]) })],
  ["an arrow function", () => () => {}],
  ["an arrow function with a prototype member", () => Object.assign(() => {}, { prototype: Animal.prototype })],
  ["a method", () => ({ method() {} }).method],
  ["a function whose prototype is a number", () => Object.assign(function () {}, { prototype: 5 })],
  ["a function whose prototype is the class's", () => Object.assign(function () {}, { prototype: Animal.prototype })],
  ["a function whose prototype is a getter", () => Object.defineProperty(function () {}.bind(), "prototype", { get: () => (log.push("get prototype"), Animal.prototype) })],
  ["an object with Symbol.hasInstance", () => ({ [Symbol.hasInstance]: value => (log.push("asked about " + typeof value), "truthy") })],
  ["an object whose Symbol.hasInstance answers zero", () => ({ [Symbol.hasInstance]: () => 0 })],
  ["an object whose Symbol.hasInstance throws", () => ({ [Symbol.hasInstance]() { throw new RangeError("no"); } })],
  ["an object whose Symbol.hasInstance is a number", () => ({ [Symbol.hasInstance]: 5 })],
  ["an object whose Symbol.hasInstance is null", () => ({ [Symbol.hasInstance]: null })],
  ["a class with a static Symbol.hasInstance", () => class { static [Symbol.hasInstance](value) { log.push("static"); return value === null; } }],
  ["a subclass that inherits it", () => class extends (class { static [Symbol.hasInstance]() { log.push("inherited"); return true; } }) {}],
  ["an object", () => ({})],
  ["an object with a prototype member", () => ({ prototype: Animal.prototype })],
  ["a string", () => "Animal"],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
  ["a symbol", () => Symbol.hasInstance],
];

const values = [
  ["a dog", () => new Dog()],
  ["an object", () => ({})],
  ["null", () => null],
  ["a number", () => 5],
  ["a proxy of a dog", () => new Proxy(new Dog(), { getPrototypeOf: target => (log.push("getPrototypeOf"), Reflect.getPrototypeOf(target)) })],
];

honest("before");
for (const [typeName, makeType] of types) {
  for (const [valueName, makeValue] of values) attempt(valueName + " instanceof " + typeName, () => isA(makeValue(), makeType()));
}

attempt("a dog whose prototype was changed", () => isAnAnimal(Object.setPrototypeOf(new Dog(), Old.prototype)));
attempt("an old object moved under the class", () => isAnAnimal(Object.setPrototypeOf(new Old(), Dog.prototype)));
attempt("an object without a prototype", () => isAnAnimal(Object.create(null)));
attempt("a proxy that claims the prototype", () => isAnAnimal(new Proxy({}, { getPrototypeOf: () => Animal.prototype })));
attempt("a proxy whose trap throws", () => isAnAnimal(new Proxy({}, { getPrototypeOf() { throw new RangeError("no"); } })));
const before = new Old();
Old.prototype = { replaced: true };
attempt("an instance made before the function's prototype was replaced", () => [before instanceof Old, new Old() instanceof Old]);
Object.defineProperty(Animal, Symbol.hasInstance, { value: value => (log.push("asked"), value === 5), configurable: true });
attempt("the class gets an instance test of its own, a dog", () => isAnAnimal(new Dog()));
attempt("the class gets an instance test of its own, five", () => isAnAnimal(5));
attempt("its subclass inherits it", () => isA(5, Dog));
delete Animal[Symbol.hasInstance];
honest("after");
