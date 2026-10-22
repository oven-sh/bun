// An initializer reads a Set, a Map or a list that a built-in has made. A function changes that collection before anybody reads what the initializer made of it, each in another way.
type Change = { name: string; change(): void; read(): unknown };
const changes: Change[] = [];
const show = (value: Iterable<unknown>) => JSON.stringify([...value]);

const added = new Set(["a", "b"]);
const fromAdded = new Set(added);
changes.push({ name: "add", change: () => void added.add("c"), read: () => show(fromAdded) });

const deleted = new Set(["a", "b"]);
const fromDeleted = Array.from(deleted);
changes.push({ name: "delete", change: () => void deleted.delete("a"), read: () => show(fromDeleted) });

const cleared = new Map([["a", 1], ["b", 2]]);
const fromCleared = new Map(cleared);
changes.push({ name: "clear", change: () => cleared.clear(), read: () => show(fromCleared) });

const stored = new Map([["a", 1]]);
const sizeOfStored = stored.size;
changes.push({ name: "set", change: () => void stored.set("b", 2), read: () => sizeOfStored });

const borrowed = new Map([["a", 1]]);
const valueOfBorrowed = borrowed.get("a");
changes.push({ name: "set.call", change: () => void Map.prototype.set.call(borrowed, "a", 9), read: () => valueOfBorrowed });

const applied = new Set(["a"]);
const hasInApplied = applied.has("z");
changes.push({ name: "Reflect.apply", change: () => void Reflect.apply(Set.prototype.add, applied, ["z"]), read: () => hasInApplied });

const walked = new Map([["a", 1], ["b", 2]]);
const keysOfWalked = [...walked.keys()];
changes.push({ name: "forEach", change: () => walked.forEach((value, key, map) => void map.delete(key)), read: () => show(keysOfWalked) });

const aliased = new Set(["a"]);
const holder = { inner: aliased };
const fromAliased = new Set(aliased);
changes.push({ name: "alias", change: () => void holder.inner.add("b"), read: () => show(fromAliased) });

const pushed = Object.keys({ a: 1, b: 2 });
const joinedPushed = pushed.join();
changes.push({ name: "push", change: () => void pushed.push("c"), read: () => joinedPushed });

const sorted = Object.keys({ b: 1, a: 2 });
const firstOfSorted = sorted[0];
changes.push({ name: "sort", change: () => void sorted.sort(), read: () => firstOfSorted });

const cut = Object.values({ a: 1, b: 2 });
const lengthOfCut = cut.length;
changes.push({ name: "length", change: () => void (cut.length = 0), read: () => lengthOfCut });

const written = "x y z".split(" ");
const copyOfWritten = written.slice();
changes.push({ name: "element", change: () => void (written[1] = "w"), read: () => show(copyOfWritten) });

const filled = "x y z".split(" ");
const joinedFilled = filled.join("-");
changes.push({ name: "fill", change: () => void filled.fill("q"), read: () => joinedFilled });

const defined = Object.entries({ a: 1 });
const firstOfDefined = defined[0][0];
changes.push({ name: "defineProperty", change: () => void Object.defineProperty(defined, 0, { value: ["z", 0] }), read: () => firstOfDefined });

const inner = Object.entries({ a: 1 });
const tableOfInner = new Map(inner);
changes.push({ name: "pair", change: () => void (inner[0][1] = 5), read: () => show(tableOfInner) });

const assigned = Object.keys({ a: 1 });
const copyOfAssigned = [...assigned];
changes.push({ name: "assign", change: () => void Object.assign(assigned, ["z", "y"]), read: () => show(copyOfAssigned) });

const handedOut = new Set(["a"]);
const fromHandedOut = new Set(handedOut);
changes.push({ name: "unknown hands", change: () => void (JSON.parse('[0]') as number[]).map(function (this: Set<string>) { this.add("b"); }, handedOut), read: () => show(fromHandedOut) });

const reparented = new Map([["a", 1]]);
const viaMethod = reparented.get("a");
changes.push({ name: "setPrototypeOf", change: () => void Object.setPrototypeOf(reparented, { get: () => "other" }), read: () => viaMethod });

for (const { change } of changes) change();
for (const { name, read } of changes) console.log(name, read());
console.log(show(added), show(deleted), cleared.size, stored.size, borrowed.get("a"), applied.has("z"), walked.size, show(aliased), pushed.join(), sorted.join(), cut.length, written.join(), filled.join(), defined[0][0], inner[0][1], assigned.join(), show(handedOut), (reparented as Map<string, unknown>).get("a"));
