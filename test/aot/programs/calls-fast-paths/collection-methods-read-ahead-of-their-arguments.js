// `m.get(f())`: the method is read before the arguments are evaluated. Where the receiver is then a Map, Set, WeakMap or WeakSet as the engine makes them, what is read is known, and the call goes straight to the lookup; whatever the arguments do in between, the function that was read is the one that is called.
// CALLS+ gets GetCollectionGetByName
// CALLS+ gets CollectionGetOrCallValue
// CALLS- gets CallValueNamed1
// CALLS+ asks GetCollectionHasByName
// CALLS+ asks CollectionHasOrCallValue
// CALLS+ sets CollectionSetOrCallValue
// CALLS+ adds CollectionAddOrCallValue
// CALLS- readsTwice Collection
// CALLS- ofAnother Collection
// CALLS- withTwo Collection
// CALLS+ getsInALoop GetCollectionGetByName
// CALLS+ getsInALoop CollectionGetOrCallValue
// CALLS+ getsAtTheEnd GetCollectionGetByName
// CALLS+ getsAtTheEnd CollectionGetOrCallValue
const functions = [
  function gets(m, key) { const found = m.get(key()); return found; },
  function asks(m, key) { const found = m.has(key()); return found; },
  function sets(m, key, value) { const result = m.set(key(), value()); return result; },
  function adds(m, key) { const result = m.add(key()); return result; },
  function readsTwice(m, key) { const get = m.get; const found = get.call(m, key()); return [get === m.get, found]; },
  function ofAnother(m, other, key) { const get = m.get; const found = get.call(other, key()); return found; },
  function withTwo(m, key) { const found = m.get(key(), 1); return found; },
  function getsInALoop(m, key) { let found; for (let i = 0; i < 2; i++) found = m.get(key()); return found; },
  function getsAtTheEnd(m, key) { return m.get(key()); },
];
const [gets, asks, sets, adds, readsTwice, ofAnother, withTwo, getsInALoop, getsAtTheEnd] = functions.map((f, i) => (...all) => functions[i](...all));
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
}
const log = [];
const say = (word, value) => () => { log.push(word); return value; };
const flush = () => log.splice(0).join(" ");

const object = {}, other = {};
const map = new Map([["a", 1], [1, "one"], [object, "object"], [NaN, "nan"], [0, "zero"]]);
const set = new Set(["a", 1, object, NaN, 0]);
const weakMap = new WeakMap([[object, "weak"]]);
const weakSet = new WeakSet([object]);
class Heir extends Map { get(key) { return "heir " + super.get(key); } }
class QuietHeir extends Map {}
const withProperty = new Map([["a", "with a property"]]);
withProperty.extra = 1;
const receivers = {
  map, set, weakMap, weakSet,
  heir: new Heir([["a", 1]]),
  quietHeir: new QuietHeir([["a", "quiet"]]),
  withProperty,
  literal: { get: k => "literal " + String(k), has: () => "literal has", set: (k, v) => "literal set " + String(v), add: () => "literal add" },
  notCallable: { get: 1, has: null, set: "text", add: {} },
  empty: {},
  proxy: new Proxy(new Map([["a", 1]]), {}),
  number: 5,
  text: "text",
  nothing: undefined,
  none: null,
};
const keys = ["a", "b", "a".concat(""), ["a"].join(""), 1, 1.0, 2, object, other, NaN, -0, undefined, null, 10n, Symbol.iterator];
for (const name in receivers) {
  const receiver = receivers[name];
  for (const key of keys) {
    console.log(name, typeof key, attempt(() => gets(receiver, say("key", key))), flush(), attempt(() => asks(receiver, say("key", key))), flush());
    console.log(name, typeof key, attempt(() => getsInALoop(receiver, say("key", key))), flush(), attempt(() => getsAtTheEnd(receiver, say("key", key))), flush());
  }
}
for (const name of ["map", "set", "weakMap", "weakSet", "heir", "literal", "notCallable", "empty", "nothing"]) {
  const receiver = receivers[name];
  console.log(name, attempt(() => sets(receiver, say("key", other), say("value", 7)) === receiver), flush(), attempt(() => adds(receiver, say("key", other)) === receiver), flush());
  console.log(name, attempt(() => sets(receiver, say("key", "primitive"), say("value", 7)) === receiver), flush(), attempt(() => adds(receiver, say("key", "primitive")) === receiver), flush());
}
console.log(map.get(other), map.size, set.has(other), set.size, weakMap.get(other), weakSet.has(other));

const changed = new Map([["a", "the engine's"]]);
console.log(gets(changed, () => { changed.get = () => "mine, too late"; return "a"; }), changed.get("a"));
console.log(gets(changed, () => { delete changed.get; return "a"; }), changed.get("a"));
changed.get = () => "mine";
console.log(gets(changed, () => { delete changed.get; return "a"; }), gets(changed, () => "a"));
console.log(gets(changed, () => { Object.setPrototypeOf(changed, null); return "a"; }), attempt(() => gets(changed, () => "a")));
const cleared = new Map([["a", 1]]);
console.log(gets(cleared, () => { cleared.clear(); return "a"; }), asks(cleared, () => { cleared.set("a", 2); return "a"; }));
const grown = new Set();
console.log(asks(grown, () => { for (let i = 0; i < 100; i++) grown.add("k" + i); return "k99"; }), adds(grown, () => { grown.clear(); return 1; }).size);
console.log(String(readsTwice(map, () => "a")), ofAnother(map, new Map([["a", "another"]]), () => "a"), withTwo(map, () => "a"));
let total = 0;
for (let i = 0; i < 1000; i++) total += gets(map, () => (i & 1 ? "a" : 0)) === 1 ? 1 : 0;
console.log(total);
