// `this` of a base constructor gets its prototype from new.target: two classes and a plain function are constructed through a value, then by Reflect.construct with every kind of new.target, across forced collections and a store to `prototype`.
const collect = globalThis.Bun ? () => globalThis.Bun.gc(true) : () => fullGC();

class A {
  x = 1;
}
class B extends A {
  y = 2;
}
function F() {
  this.z = 3;
}

class C extends B {
  w = 4;
}
class G extends F {}
class Unrelated {
  u = 5;
}
function Plain() {}
const Bound = Plain.bind(null);

let proxyReads = 0;
const proxy = new Proxy(Plain, {
  get(target, key, receiver) {
    if (key === "prototype") proxyReads++;
    return Reflect.get(target, key, receiver);
  },
});

function NumberPrototype() {}
NumberPrototype.prototype = 1;
function NullPrototype() {}
NullPrototype.prototype = null;

let getterCalls = 0;
const getterResult = {};
const WithGetter = Plain.bind(null);
Object.defineProperty(WithGetter, "prototype", {
  get() {
    getterCalls++;
    return getterResult;
  },
});

const prototypeNames = new Map([
  [Object.prototype, "Object.prototype"],
  [A.prototype, "A.prototype"],
  [B.prototype, "B.prototype"],
  [C.prototype, "C.prototype"],
  [F.prototype, "F.prototype"],
  [G.prototype, "G.prototype"],
  [Unrelated.prototype, "Unrelated.prototype"],
  [Plain.prototype, "Plain.prototype"],
  [getterResult, "getterResult"],
]);

function describe(object) {
  const properties = Reflect.ownKeys(object).map(key => `${key}=${object[key]}`);
  const matching = [A, B, F].filter(constructor => object instanceof constructor).map(constructor => constructor.name);
  return `${prototypeNames.get(Object.getPrototypeOf(object))} {${properties}} instanceof [${matching}]`;
}

const tally = new Map();
function count(line) {
  tally.set(line, (tally.get(line) ?? 0) + 1);
}
function printTally() {
  for (const [line, times] of tally) console.log(times, line);
  tally.clear();
}

function construct(constructor) {
  return new constructor();
}

const constructors = Object.values({ A, B, F });
for (let round = 0; round < 1_000; round++) {
  for (const constructor of constructors) count(`new ${constructor.name}: ${describe(construct(constructor))}`);
  if (round % 250 === 249) collect();
}
printTally();

const subclasses = new Map([
  [A, B],
  [B, C],
  [F, G],
]);
for (const constructor of constructors) {
  const targets = {
    "itself": constructor,
    "a subclass": subclasses.get(constructor),
    "an unrelated class": Unrelated,
    "a plain function": Plain,
    "a bound function": Bound,
    "a proxy": proxy,
    "a number as prototype": NumberPrototype,
    "null as prototype": NullPrototype,
    "a getter for prototype": WithGetter,
  };
  for (const [name, target] of Object.entries(targets)) {
    for (let round = 0; round < 6; round++) {
      count(`${constructor.name} with ${name}: ${describe(Reflect.construct(constructor, [], target))}`);
      if (round === 3) collect();
    }
  }
}
printTally();
console.log("prototype reads through the proxy:", proxyReads);
console.log("getter calls:", getterCalls);

const originalPrototype = F.prototype;
const q = {};
prototypeNames.set(q, "q");
const before = construct(F);
F.prototype = q;
const after = construct(F);
console.log("constructed before the store:", describe(before));
console.log("constructed after the store:", describe(after));
console.log("A with F after the store:", describe(Reflect.construct(A, [], F)));
console.log("F with its subclass after the store:", describe(Reflect.construct(F, [], G)));
F.prototype = originalPrototype;
console.log("constructed after the store is undone:", describe(construct(F)));

function attempt(label, run) {
  try {
    console.log(label, describe(run()));
  } catch (error) {
    console.log(label, error.constructor.name, error.message);
  }
}
const revoked = Proxy.revocable(Plain, {});
revoked.revoke();
for (const constructor of constructors) {
  const name = constructor.name;
  attempt(`${name} with a revoked proxy:`, () => Reflect.construct(constructor, [], revoked.proxy));
  const revoking = Proxy.revocable(Plain, {
    get() {
      revoking.revoke();
    },
  });
  attempt(`${name} with a proxy revoked by its get trap:`, () => Reflect.construct(constructor, [], revoking.proxy));
  attempt(`new ${name} afterwards:`, () => construct(constructor));
}
