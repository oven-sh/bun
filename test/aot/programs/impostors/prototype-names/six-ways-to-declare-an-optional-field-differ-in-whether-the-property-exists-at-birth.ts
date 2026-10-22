// `declare x?: T` makes nothing. `x?: T;` defines the property with undefined, in the order of the declarations. So do `x?: T = undefined` and `x: T | undefined;`.
// A parameter property stores what it was given, even undefined. A field of a merged interface makes nothing. `in`, the keys and their order tell them apart.
// A base constructor that calls a method of the derived class stores a field before the derived class defines it: the definition then puts undefined over the value.
class Declared {
  declare x?: number;
  tail = 1;
}
class Defined {
  x?: number;
  tail = 1;
}
class Initialized {
  x?: number = undefined;
  tail = 1;
}
class Union {
  x: number | undefined;
  tail = 1;
}
class Parameter {
  tail = 1;
  constructor(public x?: number) {}
}
interface Merged {
  x?: number;
}
class Merged {
  tail = 1;
}
type WithX = { x?: number; tail: number };
function xOf(object: WithX) {
  return object.x;
}
function setX(object: WithX, value: number | undefined) {
  object.x = value;
}
function state(object: WithX) {
  return `${xOf(object)} ${"x" in object} ${Object.hasOwn(object, "x")} [${Object.keys(object)}] ${JSON.stringify(object)}`;
}
const makers: [string, () => WithX][] = [
  ["declare x?", () => new Declared()],
  ["x?", () => new Defined()],
  ["x? = undefined", () => new Initialized()],
  ["x: T | undefined", () => new Union()],
  ["a parameter property, nothing given", () => new Parameter()],
  ["a parameter property, 5 given", () => new Parameter(5)],
  ["a merged interface", () => new Merged()],
];

let length = 0;
for (let i = 0; i < 3000; i++) {
  const object = makers[i % makers.length][1]();
  length += state(object).length;
  if (i & 1) setX(object, 3);
  length += Object.keys(object).join().length;
}
console.log("warm", length);

for (const [label, make] of makers) {
  const born = make();
  const stored = make();
  setX(stored, 3);
  const cleared = make();
  setX(cleared, undefined);
  const deleted = make();
  delete deleted.x;
  const again = make();
  delete again.x;
  setX(again, 4);
  console.log(`${label}: ${state(born)} | ${state(stored)} | ${state(cleared)} | ${state(deleted)} | ${state(again)}`);
}

class Base {
  constructor() {
    this.init();
  }
  init() {}
}
class KeepsIt extends Base {
  declare early?: number;
  other = 1;
  init() {
    this.early = 5;
  }
}
class LosesIt extends Base {
  early?: number;
  other = 1;
  init() {
    this.early = 5;
  }
}
class OverwritesIt extends Base {
  other = 1;
  early?: number = 6;
  init() {
    this.early = 5;
  }
}
for (let i = 0; i < 3000; i++) length += (new KeepsIt().early ?? 0) + (new LosesIt().early ?? 0) + (new OverwritesIt().early ?? 0);
console.log("warm", length);
for (const object of [new KeepsIt(), new LosesIt(), new OverwritesIt()]) console.log(object.constructor.name, object.early, "early" in object, Object.keys(object).join(), JSON.stringify(object));
