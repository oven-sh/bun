// No text names the prototypes of these three classes. They are reached through an instance:
// Object.getPrototypeOf(instance), instance.constructor.prototype and instance.__proto__. Each gets a member named like an optional field.
class ByFunction {
  declare id: number;
  declare cache?: number;
  constructor(id: number) {
    this.id = id;
  }
}
class ByConstructor {
  declare id: number;
  declare cache?: number;
  constructor(id: number) {
    this.id = id;
  }
}
class ByProto {
  declare id: number;
  declare cache?: number;
  constructor(id: number) {
    this.id = id;
  }
}
const log: string[] = [];
function one(object: ByFunction) {
  return object.cache ?? (object.cache = object.id * 2);
}
function two(object: ByConstructor) {
  return object.cache ?? (object.cache = object.id * 2);
}
function three(object: ByProto) {
  return object.cache ?? (object.cache = object.id * 2);
}
function keys(object: object) {
  return `[${Object.keys(object)}]`;
}
function aroundOne(object: ByFunction) {
  const before = object.cache;
  Object.getPrototypeOf(object).cache = 11;
  return `${before} ${object.cache}`;
}
function aroundTwo(object: ByConstructor) {
  const before = object.cache;
  (object.constructor as any).prototype.cache = 22;
  return `${before} ${object.cache}`;
}
function aroundThree(object: ByProto) {
  const before = object.cache;
  Object.defineProperty((object as any).__proto__, "cache", {
    get() {
      return undefined;
    },
    set(this: ByProto, value: number) {
      log.push(`set ${value} on ${this.id}`);
    },
    configurable: true,
  });
  return `${before} ${object.cache}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) sum += one(new ByFunction(i)) + two(new ByConstructor(i)) + three(new ByProto(i));
console.log("warm", sum);

const a = new ByFunction(1);
const b = new ByConstructor(2);
const c = new ByProto(3);
console.log("around:", aroundOne(a), "|", aroundTwo(b), "|", aroundThree(c));
console.log("old instances:", one(a), keys(a), two(b), keys(b), three(c), keys(c));
const a2 = new ByFunction(4);
const b2 = new ByConstructor(5);
const c2 = new ByProto(6);
console.log("new instances:", one(a2), keys(a2), two(b2), keys(b2), three(c2), keys(c2));
console.log(log.join(", "));
delete Object.getPrototypeOf(a).cache;
delete (b.constructor as any).prototype.cache;
delete (c as any).__proto__.cache;
console.log("gone again:", one(a), keys(a), two(b), keys(b), three(c), keys(c), log.length);
