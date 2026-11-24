// WeakSet and WeakMap take keys in place: up to the next growth, behind deletions, for objects, symbols and what is no key.
// STATISTIC: WeakTablesAllocatedByStub >= 4
const log = (...words) => console.log(...words);
const any = globalThis[process.argv[9] || "none"] || (x => x);
function keys(count) { return Array.from({ length: count }, (_, i) => i % 5 === 4 ? Symbol("s" + i) : i % 3 ? { i } : [i]); }
function fillSet(list) { const set = new WeakSet(); let same = 0; for (const key of list) same += set.add(key) === set ? 1 : 0; return [set, same]; }
function fillMap(list) { const map = new WeakMap(); let same = 0; for (let i = 0; i < list.length; i++) same += map.set(list[i], i) === map ? 1 : 0; return [map, same]; }
function held(table, list) { let n = 0; for (const key of list) n += table.has(key) ? 1 : 0; return n; }
function sum(map, list) { let n = 0; for (const key of list) { const value = map.get(key); n += value === undefined ? 1000 : value; } return n; }
function attempt(f) { try { return String(f()); } catch (error) { return error.constructor.name + ": " + error.message; } }
for (const count of [0, 1, 2, 3, 4, 5, 8, 9, 17, 64, 300]) {
  const list = keys(count), others = keys(count);
  const [set, added] = fillSet(list), [map, stored] = fillMap(list);
  log(count, added, stored, held(set, list), held(set, others), held(map, list), held(map, others), sum(map, list));
  for (let i = 0; i < count; i += 2) { set.delete(list[i]); map.delete(list[i]); }
  log(held(set, list), held(map, list), sum(map, list));
  for (const key of others) { set.add(key); map.set(key, key); }
  for (let i = 0; i < count; i++) map.set(list[i], -i);
  log(held(set, list), held(set, others), held(map, others), sum(map, list), others.every(key => map.get(key) === key));
}
const none = [1, "a", null, undefined, true, 1n, Symbol.for("registered"), NaN, 0.5];
const set = new WeakSet(), map = new WeakMap();
for (const value of none) log(attempt(() => set.add(value)), attempt(() => map.set(value, 1)), set.has(value), map.has(value), map.get(value));
log(set.add(Symbol.iterator) === set, set.has(Symbol.iterator), map.set(Symbol.iterator, 2).get(Symbol.iterator));
class Own extends WeakSet { add(key) { super.add(key); return "own add"; } }
class OwnMap extends WeakMap { set(key, value) { super.set(key, value); return "own set"; } }
const key = {};
log(new Own().add(key), new OwnMap().set(key, 1), new Own([key]).has(key), new OwnMap([[key, 3]]).get(key));
function addTo(table, key) { return table.add(key); }
function setIn(table, key, value) { return table.set(key, value); }
for (const table of [new WeakSet(), new Set(), { add: key => typeof key }, any(new WeakSet())]) log(typeof addTo(table, key), table.has ? table.has(key) : "none");
for (const table of [new WeakMap(), new Map(), { set: (key, value) => value }, any(new WeakMap())]) log(typeof setIn(table, key, 5), table.get ? table.get(key) : "none");
for (const table of [{}, null, new Map(), 5]) log(attempt(() => addTo(table, key)));
log(attempt(() => WeakSet.prototype.add.call(new Set(), key)), attempt(() => WeakMap.prototype.set.call(new Map(), key, 1)), attempt(() => WeakSet.prototype.add.call({}, key)));
log(attempt(() => WeakSet()), attempt(() => WeakMap()), new WeakSet(null).has(key), new WeakMap(undefined).has(key), attempt(() => new WeakSet(5)), attempt(() => new WeakMap([5])));
const kept = [], values = new WeakMap(), seen = new WeakSet();
for (let i = 0; i < 20000; i++) {
  const key = { i };
  values.set(key, { of: i });
  seen.add(key);
  if (i % 100 === 0) kept.push(key);
  const short = new WeakSet();
  short.add(key);
  if (!short.has(key) || short.has(kept)) log("lost", i);
}
if (typeof Bun === "object") Bun.gc(true);
log(kept.length, kept.every(key => values.get(key).of === key.i && seen.has(key)));
const fresh = keys(40);
for (const key of fresh) { values.set(key, "fresh"); seen.add(key); }
if (typeof Bun === "object") Bun.gc(true);
log(fresh.every(key => values.get(key) === "fresh" && seen.has(key)), kept.every(key => values.get(key).of === key.i));
const tagged = new WeakSet();
tagged.tag = 1;
log(Object.keys(tagged).join(), Object.prototype.toString.call(tagged), Object.prototype.toString.call(new WeakMap()), Object.getPrototypeOf(tagged) === WeakSet.prototype, tagged instanceof WeakSet, Object.isExtensible(new WeakMap()));
