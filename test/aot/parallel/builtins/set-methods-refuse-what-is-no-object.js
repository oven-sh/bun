// The seven methods of Set.prototype that take another set throw a TypeError for an operand that is no object or is not passed, also where nobody uses the answer; the receiver is tested first.
const say = (...values) => console.log(...values);
const names = ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"];
const set = new Set([1, 2]);
for (const name of names)
  for (const other of [undefined, null, 1, "text", true, 1n, Symbol("s")])
    try { set[name](other); say(name, typeof other, "no error"); } catch (e) { say(name, typeof other, e.name, e.message); }
for (const run of [() => { set.union(); }, () => { set.intersection(); }, () => { set.difference(); }, () => { set.symmetricDifference(); }, () => { set.isSubsetOf(); }, () => { set.isSupersetOf(); }, () => { set.isDisjointFrom(); }])
  try { run(); say("no error"); } catch (e) { say(e.name); }
try { Set.prototype.union.call({}, 1); } catch (e) { say(e.name, e.message); }
say([...set.union(new Set([3]))].join(), set.isSubsetOf(new Set([1, 2, 3])), [...set.intersection({ size: 1, has: value => value === 2, keys: () => [2].values() })].join());
// What node's primordials do: every method without declared operands is called on a new collection.
for (const unsafe of [Map, Set]) {
  const found = [];
  for (const key of Reflect.ownKeys(unsafe.prototype)) {
    if (key === "constructor") continue;
    const desc = Reflect.getOwnPropertyDescriptor(unsafe.prototype, key);
    if (typeof desc.value === "function" && desc.value.length === 0 && Symbol.iterator in (desc.value.call(new unsafe()) ?? {})) found.push(String(key));
  }
  say(unsafe.name, found.join());
}
