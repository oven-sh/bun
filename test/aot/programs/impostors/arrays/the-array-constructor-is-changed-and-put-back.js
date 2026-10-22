const name = ["Ar", "ray"].join("");
const RealArray = Array;

function Fake() {
  return { made: "by Fake" };
}
Fake.isArray = () => "replaced";
Fake.from = () => "replaced";
Fake.of = () => "replaced";
Fake.prototype = RealArray.prototype;

function replaced() {
  return "replaced";
}

function Species(length) {
  this.made = "replaced";
}

function told(run) {
  try {
    const answer = run();
    return answer === "replaced" || (answer && answer.made) ? "replaced" : "original";
  } catch {
    return "threw";
  }
}

const trials = {
  "Array.isArray": {
    holder: RealArray,
    key: "isArray",
    changes: {
      "a store": () => { Array.isArray = replaced; },
      "a store by a computed name": () => { globalThis[name][["is", "Array"].join("")] = replaced; },
      "Reflect.set": () => Reflect.set(RealArray, "isArray", replaced),
      "Object.defineProperty": () => { Object.defineProperty(RealArray, "isArray", { value: replaced }); },
    },
    observers: [() => Array.isArray([]), () => (Array.isArray({}) ? "replaced" : "no"), () => RealArray.isArray([]), () => Reflect.get(RealArray, "isArray")([]), () => globalThis[name].isArray([])],
  },
  "Array.from": {
    holder: RealArray,
    key: "from",
    changes: {
      "a store": () => { Array.from = replaced; },
      "Reflect.set": () => Reflect.set(RealArray, "from", replaced),
      "Object.defineProperty": () => { Object.defineProperty(RealArray, "from", { value: replaced }); },
    },
    observers: [() => Array.from([1]), () => Array.from({ length: 1 }, () => 1), () => RealArray.from("a"), () => Reflect.get(RealArray, "from").call(RealArray, [1])],
  },
  "Array.of": {
    holder: RealArray,
    key: "of",
    changes: {
      "a store": () => { Array.of = replaced; },
      "Object.defineProperty": () => { Object.defineProperty(RealArray, "of", { value: replaced }); },
    },
    observers: [() => Array.of(1), () => RealArray.of(1, 2), () => Reflect.get(RealArray, "of").call(RealArray, 1)],
  },
  "Array[Symbol.species]": {
    holder: RealArray,
    key: Symbol.species,
    changes: {
      "Object.defineProperty": () => { Object.defineProperty(RealArray, Symbol.species, { get: () => Species, configurable: true }); },
      "a value": () => { Object.defineProperty(RealArray, Symbol.species, { value: Species, configurable: true }); },
    },
    observers: [
      () => [1, 2].map(value => value),
      () => [1, 2].filter(() => true),
      () => [1, 2].slice(),
      () => [1, 2].splice(0),
      () => [1, 2].concat([3]),
      () => [1, 2].flat(),
      () => [1, 2].flatMap(value => [value]),
      () => new (Reflect.get(RealArray, Symbol.species))(1),
    ],
  },
  "Array.prototype.constructor": {
    holder: RealArray.prototype,
    key: "constructor",
    changes: {
      "a store": () => { Array.prototype.constructor = { [Symbol.species]: Species }; },
      "Reflect.set": () => Reflect.set(RealArray.prototype, "constructor", { [Symbol.species]: Species }),
      "Object.defineProperty": () => { Object.defineProperty(RealArray.prototype, "constructor", { value: { [Symbol.species]: Species } }); },
    },
    observers: [
      () => [1, 2].map(value => value),
      () => [1, 2].filter(() => true),
      () => [1, 2].slice(),
      () => [1, 2].concat([3]),
      () => new ([].constructor[Symbol.species])(1),
    ],
  },
  "the global Array": {
    holder: globalThis,
    key: "Array",
    changes: {
      "a store": () => { Array = Fake; },
      "a store to the global object": () => { globalThis.Array = Fake; },
      "a store by a computed name": () => { globalThis[name] = Fake; },
      "Reflect.set": () => Reflect.set(globalThis, name, Fake),
      "Object.defineProperty": () => { Object.defineProperty(globalThis, name, { value: Fake }); },
    },
    observers: [() => Array.isArray([]), () => new Array(3), () => Array(3), () => Array.from([1]), () => Array.of(1), () => globalThis.Array.isArray([]), () => globalThis[name].isArray([]), () => Reflect.get(globalThis, name).isArray([])],
  },
};

for (const label in trials) for (let i = 0; i < 500; i++) for (const observer of trials[label].observers) observer();

for (const label in trials) {
  const { holder, key, changes, observers } = trials[label];
  for (const way in changes) {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    try {
      changes[way]();
    } catch {}
    const during = [];
    for (let i = 0; i < observers.length; i++) during[i] = told(observers[i]);
    try {
      Object.defineProperty(holder, key, descriptor);
    } catch {}
    const after = [];
    for (let i = 0; i < observers.length; i++) after[i] = told(observers[i]);
    const agreed = during.every(answer => answer === during[0]);
    const restored = after.every(answer => answer === "original");
    console.log((agreed && restored ? "ok " : "WRONG ") + label + ", " + way + (agreed ? ": every use saw the same" : ": uses saw " + during.join()) + (restored ? ", and the original afterwards" : ", and afterwards " + after.join()));
  }
}

console.log("literals are arrays all along: " + RealArray.isArray([1]) + " " + ([1] instanceof RealArray) + " " + [1, 2].length);
