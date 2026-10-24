// The object does not change inside the loop, so the test of its prototype and the read of its empty slot look invariant.
// In the round before the last, something in the loop's own body puts the name on the prototype: a store under a key, a typed store whose receiver is the prototype,
// Object.defineProperty, a small function of the program, Object.setPrototypeOf on the prototype, and a store to an object that was hung above the prototype earlier.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class ByKey {
  v?: number;
  constructor(public id: number) {
    delete this.v;
    handOver(this);
  }
}
class ByTypedStore {
  v?: number;
  constructor(public id: number) {
    delete this.v;
    handOver(this);
  }
}
class ByDefinition {
  v?: number;
  constructor(public id: number) {
    delete this.v;
    handOver(this);
  }
}
class ByFunction {
  v?: number;
  constructor(public id: number) {
    delete this.v;
    handOver(this);
  }
}
class ByLink {
  v?: number;
  constructor(public id: number) {
    delete this.v;
    handOver(this);
  }
}
class ByObjectAbove {
  v?: number;
  constructor(public id: number) {
    delete this.v;
    handOver(this);
  }
}
function byKey(object: ByKey, rounds: number, holder: any, key: string) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += object.v ?? 1;
    if (i === rounds - 2) holder[key] = 100;
  }
  return sum;
}
function byTypedStore(object: ByTypedStore, rounds: number, other: ByTypedStore) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += object.v ?? 1;
    if (i === rounds - 2) other.v = 100;
  }
  return sum;
}
function byDefinition(object: ByDefinition, rounds: number, holder: object) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += object.v ?? 1;
    if (i === rounds - 2) Object.defineProperty(holder, "v", { get: () => 100, configurable: true });
  }
  return sum;
}
function arrive() {
  (ByFunction.prototype as any)["v"] = 100;
}
function byFunction(object: ByFunction, rounds: number, arm: boolean) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += object.v ?? 1;
    if (arm && i === rounds - 2) arrive();
  }
  return sum;
}
function byLink(object: ByLink, rounds: number, holder: object, above: object) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += object.v ?? 1;
    if (i === rounds - 2) Object.setPrototypeOf(holder, above);
  }
  return sum;
}
function byObjectAbove(object: ByObjectAbove, rounds: number, above: { v?: number }) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += object.v ?? 1;
    if (i === rounds - 2) above.v = 100;
  }
  return sum;
}
function storesInALoop(object: ByKey, rounds: number, holder: object, log: number[]) {
  for (let i = 0; i < rounds; i++) {
    delete object.v;
    if (i === rounds - 2) Object.defineProperty(holder, "v", { set: value => void log.push(value), configurable: true });
    object.v = i;
  }
  return `${object.v} [${Object.keys(object)}] ${log}`;
}

const scrap: any = {};
const above: { v?: number } = {};
Object.setPrototypeOf(ByObjectAbove.prototype, above);
console.log(
  "no change:",
  byKey(new ByKey(1), 3000, scrap, "v"),
  byTypedStore(new ByTypedStore(1), 3000, new ByTypedStore(2)),
  byDefinition(new ByDefinition(1), 3000, scrap),
  byFunction(new ByFunction(1), 3000, false),
  byLink(new ByLink(1), 3000, scrap, {}),
  byObjectAbove(new ByObjectAbove(1), 3000, {}),
  storesInALoop(new ByKey(1), 3000, scrap, []),
);
console.log("a store under a key:", byKey(new ByKey(2), 3000, ByKey.prototype, "v"));
console.log("a typed store:", byTypedStore(new ByTypedStore(2), 3000, ByTypedStore.prototype));
console.log("a definition:", byDefinition(new ByDefinition(2), 3000, ByDefinition.prototype));
console.log("a function:", byFunction(new ByFunction(2), 3000, true));
console.log("a link:", byLink(new ByLink(2), 3000, ByLink.prototype, { v: 100 }));
console.log("an object above:", byObjectAbove(new ByObjectAbove(2), 3000, above));
delete (ByKey.prototype as any).v;
console.log("stores:", storesInALoop(new ByKey(3), 3000, ByKey.prototype, []));
