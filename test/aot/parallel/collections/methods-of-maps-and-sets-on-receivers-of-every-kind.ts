// A method of a Map, a Set, a WeakMap or a WeakSet that is called by name outside a loop is one call of a stub, which looks at the receiver itself: whatever is not as its class makes it is called by name.
const table = new Map<unknown, unknown>(), members = new Set<unknown>(), weak = new WeakMap<object, unknown>(), weakMembers = new WeakSet<object>();
const key = {}, other = {};
function attempt(f: () => unknown) { try { return String(f()); } catch (error) { return (error as Error).name + ": " + (error as Error).message; } }
function get(k: unknown) { return table.get(k); }
function has(k: unknown) { return table.has(k); }
function set(k: unknown, v: unknown) { return table.set(k, v) === table; }
function remove(k: unknown) { return table.delete(k); }
function add(k: unknown) { return members.add(k) === members; }
function holds(k: unknown) { return members.has(k); }
function drop(k: unknown) { return members.delete(k); }
function weakGet(k: any) { return weak.get(k); }
function weakHas(k: any) { return weak.has(k); }
function weakSet(k: any, v: unknown) { return weak.set(k, v) === weak; }
function weakHolds(k: any) { return weakMembers.has(k); }
function getOf(m: Map<unknown, unknown>, k: unknown) { return m.get(k); }
function hasOf(s: Set<unknown>, k: unknown) { return s.has(k); }
function few(m: Map<unknown, unknown>) { return [(m as any).get(), (m as any).has(), (m as any).get(1, 2, 3)].join(); }
const keys = [1, 1.5, NaN, 0, -0, "a", "a" + String.fromCharCode(98), "", null, undefined, true, key, 10n, Symbol.iterator];
for (const k of keys) console.log([get(k), has(k), set(k, String(k)), get(k), has(k), add(k), holds(k)].join(" "));
console.log(table.size, members.size, get("ab"), get(-0), holds(0), remove("a"), remove("a"), drop(NaN), drop(NaN), table.size, members.size);
console.log(weakGet(key), weakHas(key), weakSet(key, 1), weakGet(key), weakHas(key), weakGet(other), weakHolds(key), attempt(() => weakSet(1, 2)), weakGet(1), weakHas("x"), weakHolds(null));
class Counted extends Map<unknown, unknown> { reads = 0; get(k: unknown) { this.reads++; return super.get(k); } }
const counted = new Counted([[1, "one"]]);
const shadowed = new Map<unknown, unknown>([[1, "one"]]); (shadowed as any).get = () => "own";
const moved = new Map<unknown, unknown>([[1, "one"]]); Object.setPrototypeOf(moved, { get() { return "moved"; } });
const bare = new Map<unknown, unknown>([[1, "one"]]); Object.setPrototypeOf(bare, null);
const named = new Map<unknown, unknown>([[1, "one"]]); (named as any).extra = 1;
const frozen = Object.freeze(new Map<unknown, unknown>([[1, "one"]]));
for (let round = 0; round < 3; round++)
  console.log([getOf(table, 1), getOf(counted, 1), counted.reads, getOf(shadowed, 1), getOf(moved, 1), attempt(() => getOf(bare, 1)), getOf(named, 1), getOf(frozen, 1), attempt(() => getOf(members as any, 1)), attempt(() => getOf({ get: (k: unknown) => "object " + k } as any, 1)), attempt(() => getOf(null as any, 1)), attempt(() => getOf(5 as any, 1)), attempt(() => hasOf(table as any, 1)), hasOf(members, 1), few(table)].join(" | "));
