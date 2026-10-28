// The counterpart of unknown-property-is-not-assignable-to-a-method.ts: `any` is assignable to a function type, so { of(owner: Owner): T } may hold the external data that is passed as { of: any }, and class Store accepts objects its constructor has not made.
// IR+ ^layout (L\d+) .*name="Store" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
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
function has(value: { of: any }): boolean { return value.of !== undefined; }
console.log(total(), has(answer), answer.outcome);
