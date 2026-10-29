// Objects with elements lie below a prototype object before it gets a setter under an index, forty thousand times over. Then objects of every make get their elements first and the setter above them second, and each store goes where it goes in plain Bun.
const log = [];
const setter = {
  set(value) {
    log.push(value);
  },
  configurable: true,
};

function once() {
  const prototype = class {}.prototype;
  const below = Object.setPrototypeOf([1, 2], prototype);
  Object.defineProperty(prototype, 3, setter);
  return below;
}
const kept = [];
for (let i = 0; i < 40_000; i++) kept.push(once());
kept[0][3] = "the first";
kept[39_999][3] = "the last";
console.log(JSON.stringify(log), kept[0].length, kept[39_999].length);

class List extends Array {}
class Longer extends List {}
class Holder {
  constructor() {
    this[0] = "zero";
    this[1] = "one";
  }
}
function Made() {
  this[0] = "zero";
}
const FromText = new Function("return class FromText extends Array {}")();
const literalAbove = {};
const middle = {};
const top = {};
Object.setPrototypeOf(middle, top);

const makes = {
  "an instance of a class below Array": [List.prototype, () => new List(1, 2)],
  "List.of": [List.prototype, () => List.of(1, 2)],
  "List.from": [List.prototype, () => List.from([1, 2])],
  "what map returns for an instance": [List.prototype, () => new List(1, 2).map(value => value)],
  "what slice returns for an instance": [List.prototype, () => new List(1, 2).slice()],
  "an instance two classes below Array": [List.prototype, () => new Longer(1, 2)],
  "Reflect.construct of Array for the class": [List.prototype, () => Reflect.construct(Array, [1, 2], List)],
  "an instance of a class made from text": [FromText.prototype, () => new FromText(1, 2)],
  "an instance that text makes": [List.prototype, new Function("List", "return new List(1, 2)").bind(null, List)],
  "an object that text creates below a literal and fills": [
    literalAbove,
    new Function("above", "const made = Object.create(above); made[0] = 'a'; return made;").bind(null, literalAbove),
  ],
  "an instance whose constructor stores elements": [Holder.prototype, () => new Holder()],
  "an instance of a constructor function": [Made.prototype, () => new Made()],
  "an object created below a literal": [literalAbove, () => Object.assign(Object.create(literalAbove), ["a", "b"])],
  "a literal that names its prototype": [literalAbove, () => ({ __proto__: literalAbove, 0: "a", 1: "b" })],
  "an array moved below a literal": [literalAbove, () => Object.setPrototypeOf(["a", "b"], literalAbove)],
  "an object two below the one that changes": [top, () => Object.assign(Object.create(middle), ["a"])],
  "an arguments object moved below a literal": [
    literalAbove,
    () =>
      Object.setPrototypeOf(
        (function () {
          return arguments;
        })(1, 2),
        literalAbove,
      ),
  ],
};

const made = Object.entries(makes).map(([name, [prototype, make]]) => [name, prototype, make()]);
const ordinary = [1, 2];
const plainObject = { 0: "a" };
for (const prototype of new Set(made.map(([, prototype]) => prototype))) Object.defineProperty(prototype, 3, setter);
for (const [name, , object] of made) {
  log.length = 0;
  object[3] = name;
  console.log(name, JSON.stringify(log), Object.hasOwn(object, 3), object.length);
}
for (const [name, [, make]] of Object.entries(makes)) {
  log.length = 0;
  const later = make();
  later[3] = name;
  console.log("later:", name, JSON.stringify(log), Object.hasOwn(later, 3), later.length);
}
log.length = 0;
ordinary[3] = "ordinary";
plainObject[3] = "plain";
console.log(JSON.stringify(log), JSON.stringify(ordinary), JSON.stringify(plainObject));

const parent = [1, 2, 3];
const child = Object.create(parent);
child[0] = "own";
const above = {};
Object.setPrototypeOf(parent, above);
Object.defineProperty(above, 5, setter);
log.length = 0;
parent[5] = "into the parent";
child[5] = "into the child";
console.log(JSON.stringify(log), Object.hasOwn(parent, 5), Object.hasOwn(child, 5), parent.length);
