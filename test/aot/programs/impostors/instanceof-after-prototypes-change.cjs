const log = [];

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + String(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function Fruit() {
  this.sweet = true;
}
function Apple() {
  Fruit.call(this);
  this.round = true;
}
Apple.prototype = Object.create(Fruit.prototype);
Apple.prototype.constructor = Apple;

function isFruit(value) {
  return value instanceof Fruit;
}

function isApple(value) {
  return value instanceof Apple;
}

function isInstance(value, Maker) {
  return value instanceof Maker;
}

function sweetIfFruit(value) {
  if (value instanceof Fruit) return value.sweet;
  return "not a fruit";
}

const apple = new Apple();
let count = 0;
for (let i = 0; i < 2000; i++) if (isFruit(apple) && isApple(apple) && isInstance(apple, Apple) && sweetIfFruit(apple)) count++;
console.log("2000 honest tests", count);

const values = [
  ["an apple", apple],
  ["a fruit", new Fruit()],
  ["a literal with the same fields", { sweet: true, round: true }],
  ["an object made from Apple.prototype", Object.create(Apple.prototype)],
  ["Apple.prototype itself", Apple.prototype],
  ["a literal moved under Apple.prototype", Object.setPrototypeOf({ sweet: "moved" }, Apple.prototype)],
  ["an apple moved under Object.prototype", Object.setPrototypeOf(new Apple(), Object.prototype)],
  ["an apple without a prototype", Object.setPrototypeOf(new Apple(), null)],
  ["a proxy around an apple", new Proxy(new Apple(), { getPrototypeOf(target) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); } })],
  ["a proxy that claims to be an apple", new Proxy({}, { getPrototypeOf() { log.push("getPrototypeOf"); return Apple.prototype; } })],
  ["a function", function () {}],
  ["a number", 5],
  ["a string", "apple"],
  ["null", null],
  ["undefined", undefined],
];

function lookAtAll(phase) {
  for (const [label, value] of values) {
    attempt(phase + ", " + label + " instanceof Fruit", () => isFruit(value));
    attempt(phase + ", " + label + " instanceof Apple", () => isApple(value));
    attempt(phase + ", " + label + " sweet if a fruit", () => sweetIfFruit(value));
  }
}

lookAtAll("untouched");

const firstApplePrototype = Apple.prototype;
Apple.prototype = Object.create(Fruit.prototype);
lookAtAll("Apple.prototype replaced");
Apple.prototype = firstApplePrototype;

Object.setPrototypeOf(Apple.prototype, Object.prototype);
lookAtAll("Apple cut off from Fruit");
Object.setPrototypeOf(Apple.prototype, Fruit.prototype);

Object.defineProperty(Fruit, Symbol.hasInstance, { value(value) { log.push("hasInstance"); return value === 5; }, configurable: true });
lookAtAll("Fruit has its own Symbol.hasInstance");
delete Fruit[Symbol.hasInstance];

lookAtAll("everything put back");

const makers = [
  ["a bound Apple", Apple.bind(null)],
  ["a proxy around Apple", new Proxy(Apple, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } })],
  ["a function whose prototype is a number", Object.assign(function () {}, { prototype: 5 })],
  ["an arrow function", () => {}],
  ["an object with Symbol.hasInstance", { [Symbol.hasInstance]: value => value === apple }],
  ["a plain object", {}],
  ["a number", 5],
  ["undefined", undefined],
  ["Object", Object],
  ["Function", Function],
];
for (const [label, Maker] of makers) {
  attempt("an apple instanceof " + label, () => isInstance(apple, Maker));
  attempt("5 instanceof " + label, () => isInstance(5, Maker));
  attempt("honest again", () => isInstance(apple, Apple));
}

function Pear() {
  this.sweet = "pear";
}
Pear.prototype = Apple.prototype;
function isPear(value) {
  return value instanceof Pear;
}
attempt("an apple instanceof a function that shares Apple's prototype object", () => isPear(apple));
attempt("a pear instanceof Apple", () => isApple(new Pear()));
attempt("a pear instanceof Fruit", () => isFruit(new Pear()));
attempt("a pear, sweet if a fruit", () => sweetIfFruit(new Pear()));
attempt("the constructor of a pear is Apple", () => new Pear().constructor === Apple);
Pear.prototype = Fruit.prototype;
attempt("after Pear took Fruit's prototype object, an apple instanceof Pear", () => isPear(apple));
attempt("a new pear instanceof Apple", () => isApple(new Pear()));
attempt("a fruit instanceof Pear", () => isPear(new Fruit()));
