// The exotic object behavior of a module namespace, reached through an untyped alias.
import * as exported from "./exports.js";
import * as cycle from "./cycle.js";

function attempt(action) {
  try {
    return `returned ${String(action())}`;
  } catch (error) {
    return `threw ${error.name}`;
  }
}

globalThis.namespaces = [exported, cycle];
const [untyped, other] = globalThis.namespaces;

const sloppyStore = new Function("target", "name", "target[name] = 1; return target[name];");
const sloppyDelete = new Function("target", "name", "return delete target[name];");

for (const [name, outcome] of cycle.probes) console.log("dead zone", name, outcome);

const keys = Object.keys(untyped);
console.log(keys.length, keys.join());
console.log(keys.join() === [...keys].sort().join());
const ownKeys = Reflect.ownKeys(untyped);
console.log(ownKeys.length, String(ownKeys[ownKeys.length - 1]));
console.log(Object.keys(other).join());

console.log(JSON.stringify(Object.getOwnPropertyDescriptor(untyped, "value07")));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(untyped, Symbol.toStringTag)));
console.log(Object.getOwnPropertyDescriptor(untyped, "missing"));

console.log("value07" in untyped, "missing" in untyped, Symbol.toStringTag in untyped);
console.log(untyped[Symbol.toStringTag], Object.prototype.toString.call(untyped), Object.getPrototypeOf(untyped));

console.log(untyped.counter, exported.counter);
untyped.increment();
console.log(untyped.counter, exported.counter);

const sharedNames = ["counter", "value10", "missing", "value20"];
const reads = [];
for (let round = 0; round < 4; round++) {
  for (const namespace of [untyped, other, untyped]) {
    for (const name of sharedNames) reads.push(namespace[name]);
  }
  untyped.increment();
}
console.log(reads.join());

for (const target of [untyped, other]) {
  console.log(attempt(() => (target.value10 = 5)), target.value10);
  console.log(attempt(() => (target.missing = 5)), target.missing);
  console.log(attempt(() => sloppyStore(target, "value10")), attempt(() => sloppyStore(target, "missing")));
  console.log(attempt(() => Reflect.set(target, "value10", 5)));
}

const sameValue = untyped.value07;
console.log(attempt(() => Object.defineProperty(untyped, "value07", { value: 99 })));
console.log(attempt(() => Object.defineProperty(untyped, "value07", { value: sameValue }) === untyped));
console.log(attempt(() => Object.defineProperty(untyped, "value07", { writable: false })));
console.log(attempt(() => Object.defineProperty(untyped, "missing", { value: 1 })));
console.log(Reflect.defineProperty(untyped, "value07", { value: 99 }), Reflect.defineProperty(untyped, "value07", { value: sameValue }));
console.log(untyped.value07);

console.log(attempt(() => delete untyped.value07), attempt(() => delete untyped.missing));
console.log(attempt(() => sloppyDelete(untyped, "value07")), attempt(() => sloppyDelete(untyped, "missing")));
console.log(Reflect.deleteProperty(untyped, "value07"), Reflect.deleteProperty(untyped, Symbol.toStringTag));
console.log(untyped.value07);

console.log(attempt(() => Object.setPrototypeOf(untyped, {})));
console.log(attempt(() => Object.setPrototypeOf(untyped, null) === untyped));
console.log(Reflect.setPrototypeOf(untyped, {}), Reflect.setPrototypeOf(untyped, null));

console.log(attempt(() => Object.preventExtensions(untyped) === untyped), Reflect.preventExtensions(untyped));
console.log(Object.isExtensible(untyped), Object.isSealed(untyped), Object.isFrozen(untyped));
console.log(attempt(() => Object.freeze(untyped)));
