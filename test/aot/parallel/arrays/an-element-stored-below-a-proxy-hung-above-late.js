// An object has a getter under an index, and 300 heirs of it take elements. Then a proxy is hung above it: a store to an index that it lacks must ask the `set` trap, as for an object without heirs.
function intercept() {
  return new Proxy({}, {
    set(target, key, value, receiver) {
      console.log("the trap runs for", String(key));
      return Reflect.set(target, key, value, receiver);
    },
  });
}
const plain = { named: 1 };
Object.setPrototypeOf(plain, intercept());
plain[0] = "stored";
console.log("an object:", Object.keys(plain).join());

const withGetter = { named: 1 };
Object.defineProperty(withGetter, "6", { get: () => "only a getter", configurable: true });
Object.setPrototypeOf(withGetter, intercept());
withGetter[0] = "stored";
console.log("an object with a getter under an index:", Object.keys(withGetter).join());

const parent = { named: 1 };
Object.defineProperty(parent, "6", { get: () => "only a getter", configurable: true });
for (let round = 0; round < 300; round++) Object.create(parent)[round % 5] = round;
Object.setPrototypeOf(parent, intercept());
parent[0] = "stored";
console.log("the same, after heirs of it took elements:", Object.keys(parent).join());
