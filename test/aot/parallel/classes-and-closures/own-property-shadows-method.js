// An own property added to one instance hides a method or accessor that its class declares. Other instances still see the class's members, and a property spelled like a private name hides nothing.
class A {
  m() {
    return 1;
  }
  get g() {
    return 2;
  }
  #p() {
    return 3;
  }
  callP() {
    return this.#p();
  }
}
class B extends A {}

function useMembers(b) {
  let m = 0;
  let g = 0;
  let p = 0;
  for (let i = 0; i < 10000; i++) {
    m += b.m();
    g += b.g;
    p += b.callP();
  }
  return "m " + m + ", g " + g + ", callP " + p;
}

function describeOwn(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return key + ":" + (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
    })
    .join(" ");
}

function show(name, b) {
  console.log(name + ": " + useMembers(b) + ", own [" + describeOwn(b) + "], instanceof B " + (b instanceof B));
}

const b1 = new B();
const b2 = new B();
show("b1", b1);
show("b2", b2);

const changes = [
  ["m = () => 10", alias => (alias.m = () => 10)],
  ['defineProperty "g"', alias => Object.defineProperty(alias, "g", { value: 20 })],
  ['["#p"] = 30', alias => (alias["#p"] = 30)],
  ["p = 31", alias => (alias.p = 31)],
];
for (const [name, change] of changes) {
  for (const alias of [{}, b1, []]) change(alias);
  show("b1 after " + name, b1);
  show("b2 after " + name, b2);
}
show("a new instance", new B());
console.log("spelled like the private name: " + [b1["#p"], b1.p, b2["#p"], b2.p, "#p" in b1, "p" in b1, "#p" in b2, "p" in b2].join());
console.log("deleted: " + [Reflect.deleteProperty(b1, "m"), Reflect.deleteProperty(b1, "g"), Reflect.deleteProperty(b1, "#p")].join());
show("b1 after the deletions", b1);
show("b2 after the deletions", b2);

const ways = [
  ["Reflect.set", b => Reflect.set(b, "m", () => 11)],
  ["Object.assign", b => Object.assign(b, { m: () => 12 }) === b],
  ["a computed key", (b, key) => typeof (b[key] = () => 13)],
  ["Reflect.defineProperty with a getter", b => Reflect.defineProperty(b, "g", { get: () => 21, configurable: true })],
  ["Object.defineProperties", b => Object.defineProperties(b, { m: { value: () => 14 }, g: { value: 22 } }) === b],
  ["the method that calls the private method", b => Reflect.set(b, "callP", () => 33)],
  ["a store to g, which has no setter", b => Reflect.set(b, "g", 23)],
  ["a store to m on a frozen instance", b => Reflect.set(Object.freeze(b), "m", () => 15)],
];
for (const [name, hide] of ways) {
  const changed = new B();
  const unchanged = new B();
  useMembers(changed);
  console.log(name + ": " + hide(changed, "m"));
  show("  changed", changed);
  show("  unchanged", unchanged);
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
  get first() {
    return this.x;
  }
}

function total(points) {
  let result = 0;
  for (let i = 0; i < 5000; i++) {
    for (const point of points) result += point.sum() + point.first;
  }
  return result;
}

const points = [new Point(1, 2), new Point(3, 4), new Point(5, 6)];
console.log("points: " + total(points));
for (const alias of [{}, points[1]]) {
  alias.sum = function () {
    return this.x * this.y;
  };
}
console.log("points with one sum hidden: " + total(points) + ", keys " + points.map(point => Object.keys(point).join("+")).join() + ", " + JSON.stringify(points));
points[1].x = 7;
points[2].x = 8;
console.log("points after stores to x: " + total(points) + ", " + JSON.stringify(points));

class Replaced {
  m() {
    return 1;
  }
  get g() {
    return 2;
  }
}
class ReplacedSub extends Replaced {}

function sumMembers(objects) {
  let result = 0;
  for (let i = 0; i < 5000; i++) {
    for (const object of objects) result += object.m() + object.g;
  }
  return result;
}

const replaced = [new Replaced(), new ReplacedSub(), new ReplacedSub()];
console.log("members that the program replaces later: " + sumMembers(replaced));
for (const alias of [{}, replaced[1]]) {
  alias.m = () => 100;
  Object.defineProperty(alias, "g", { value: 200, configurable: true });
}
console.log("hidden on one instance: " + sumMembers(replaced));
Replaced.prototype.m = () => 1000;
Object.defineProperty(Replaced.prototype, "g", { get: () => 2000 });
console.log("replaced on the prototype: " + sumMembers(replaced));
console.log("deleted from the instance: " + [delete replaced[1].m, delete replaced[1].g].join() + ", " + sumMembers(replaced));

function createCounterClass(step) {
  return class Counter {
    m() {
      return step;
    }
    get g() {
      return step * 2;
    }
  };
}
class Plain {
  m() {
    return 6;
  }
  get g() {
    return 7;
  }
}
class WithPrivateMethod {
  #secret() {
    return 8;
  }
  m() {
    return 9;
  }
  get g() {
    return this.#secret();
  }
}

function checkIdentity(name, K) {
  const x = new K();
  const prototype = Object.getPrototypeOf(x);
  const early = x.m;
  console.log(name + ", before the keys: " + [x.m === x.m, x.m === prototype.m, Reflect.get(x, "m") === early, early(), x.g, x.constructor === K, typeof x["#secret"]].join());
  console.log(name + ", keys: [" + Object.keys(prototype).join() + "], names: " + Object.getOwnPropertyNames(prototype).join());
  console.log(name + ", after the keys: " + [x.m === x.m, x.m === prototype.m, x.m === early, new K().m === early, early(), x.g, x.constructor === K, typeof x["#secret"]].join());
}
checkIdentity("a class that captures a local", createCounterClass(5));
checkIdentity("a class at the top level", Plain);
checkIdentity("a class with a private method", WithPrivateMethod);

class Redeclared {
  get m() {
    return () => "the getter of m";
  }
  m() {
    return "the method m";
  }
  g() {
    return "the method g";
  }
  get g() {
    return "the getter of g";
  }
  get h() {
    return "the getter of h";
  }
  h() {
    return "the method h";
  }
  set h(value) {}
}

function describeRedeclared(x) {
  return [typeof x.m, typeof x.g, typeof x.h, typeof Reflect.get(x, "m"), typeof Reflect.get(x, "g"), typeof Reflect.get(x, "h"), Reflect.has(x, "h")].join();
}
const redeclared = new Redeclared();
console.log("names declared twice, before the keys: " + describeRedeclared(redeclared));
checkIdentity("a class that declares names twice", Redeclared);
console.log("names declared twice, after the keys: " + describeRedeclared(redeclared) + ", h " + Object.keys(Object.getOwnPropertyDescriptor(Redeclared.prototype, "h")).join("+"));

class Cached {
  m() {
    return "declared m";
  }
  get g() {
    return "declared g";
  }
}
class CachedSub extends Cached {}

function readByName(objects) {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    for (const object of objects) seen.add(object.m() + ", " + object.g + ", " + object.constructor.name);
  }
  return [...seen].join(" | ");
}

const cached = [new Cached(), new CachedSub(), { m: () => "own m", g: "own g" }];
console.log("read by name: " + readByName(cached));
console.log("keys of the prototype: " + Object.keys(Cached.prototype).length);
console.log("read by name again: " + readByName(cached));
Cached.prototype.m = () => "replaced m";
Object.defineProperty(Cached.prototype, "g", { get: () => "replaced g" });
console.log("read by name after the members changed: " + readByName(cached));
