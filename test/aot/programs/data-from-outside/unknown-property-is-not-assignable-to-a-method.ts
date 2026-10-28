// External data of type Pending is passed as { of: unknown }, so that type is external data too. { of(owner: Owner): T } only shares the property name: `unknown` is not assignable to a function type, so it keeps its layout, the generic call's result is checked against Store, and class Store stays closed.
// IR+ ^layout L\d+ .*name="Store" .* representation=Typed
// IR- ^layout (L\d+) .*name="Store" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
class Owner { id = 1; }
class Slot<T extends object> {
  readonly #create: () => T;
  readonly #states = new WeakMap<Owner, T>();
  constructor(create: () => T) { this.#create = create; }
  of(owner: Owner): T {
    const existing = this.#states.get(owner);
    if (existing !== undefined) return existing;
    const created = this.#create();
    this.#states.set(owner, created);
    return created;
  }
}
const root = { owner: new Owner() };
function onRoot<T>(slot: { of(owner: Owner): T }): T { return slot.of(root.owner); }
class Store {
  cache = 1;
  settled = false;
  readCache(): number { return this.cache; }
}
const stores = new Slot(() => new Store());
function theStore(): Store { return onRoot(stores); }
function total(): number {
  const store = theStore();
  return store.readCache() + (store.settled ? 1 : 0);
}
interface Pending { readonly outcome: "pending"; readonly of: "held" | "newer" }
const answer: Pending = JSON.parse('{"outcome":"pending","of":"held"}');
function has(value: { of: unknown }): boolean { return value.of !== undefined; }
console.log(total(), has(answer), answer.outcome);
