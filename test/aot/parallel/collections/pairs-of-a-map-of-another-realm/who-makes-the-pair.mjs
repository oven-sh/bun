// The pairs that a Map hands out are lists, and a list belongs to a realm: that of the `next` which makes it. Every form runs several times.
import vm from "node:vm";
const context = vm.createContext({});
const their = (text) => vm.runInContext(text, context);
const box = {}; globalThis.box = box;
const whose = (pair) => Object.getPrototypeOf(pair) === Array.prototype ? "ours" : Object.getPrototypeOf(pair) === their("Array.prototype") ? "theirs" : "nobody's";
const TheirMap = their("Map"), TheirSet = their("Set");
const makers = {
  "their Map": () => their("new Map([[1, 2], [3, 4]])"),
  "our Map": () => new Map([[1, 2], [3, 4]]),
  "a Map made here by their class": () => new TheirMap([[1, 2]]),
  "an instance of their class below Map": () => their("new (class Below extends Map {})([[1, 2]])"),
  "an instance of our class below their Map": () => new (class Below extends TheirMap {})([[1, 2]]),
  "our Map by new.target of theirs": () => Reflect.construct(Map, [[[1, 2]]], TheirMap),
  "their Map by new.target of ours": () => Reflect.construct(TheirMap, [[[1, 2]]], Map),
};
function spread(items) { return [...items][0]; }
function from(items) { return Array.from(items)[0]; }
function taken(items) { const [pair] = items; return pair; }
function looped(items) { for (const pair of items) return pair; }
function loopedToTheEnd(items) { let last; for (const pair of items) last = pair; return last; }
function entriesLooped(map) { for (const pair of map.entries()) return pair; }
function passed(...pairs) { return pairs[0]; }
const theirFrom = their("(items) => Array.from(items)[0]"), theirSpread = their("(items) => [...items][0]"), theirLoop = their("(items) => { for (const pair of items) return pair; }"), theirTaken = their("(items) => { const [pair] = items; return pair; }");
for (let turn = 0; turn < 3; turn++) for (const [name, make] of Object.entries(makers)) {
  const row = [];
  for (const [form, run] of Object.entries({ spread, from, taken, looped, loopedToTheEnd, theirFrom, theirSpread, theirLoop, theirTaken })) row.push(form + " " + whose(run(make())) + "/" + whose(run(make().entries())) + "/" + whose(run(make()[Symbol.iterator]())));
  row.push("entriesLooped " + whose(entriesLooped(make())), "passed " + whose(passed(...make())) + "/" + whose(passed(...make().entries())));
  box.items = make(); let unknown; for (const pair of box.items) { unknown = pair; break; } row.push("unknown " + whose(unknown) + "/" + whose([...box.items][0]) + "/" + whose(Array.from(box.items)[0]));
  console.log(name + ": " + row.join(" . "));
}
// The method of one realm on the Map of the other: the iterator is of the method's realm, and so is its `next`.
for (let turn = 0; turn < 3; turn++) {
  const ours = new Map([[1, 2]]), theirs = their("new Map([[1, 2]])");
  console.log("our entries on their Map:", whose(spread(Map.prototype.entries.call(theirs))), whose(from(Map.prototype.entries.call(theirs))), whose(looped(Map.prototype.entries.call(theirs))), whose(taken(Map.prototype.entries.call(theirs))));
  console.log("their entries on our Map:", whose(spread(TheirMap.prototype.entries.call(ours))), whose(from(TheirMap.prototype.entries.call(ours))), whose(looped(TheirMap.prototype.entries.call(ours))), whose(taken(TheirMap.prototype.entries.call(ours))));
  console.log("entries of Sets:", whose(spread(new TheirSet([1]).entries())), whose(from(new TheirSet([1]).entries())), whose(looped(new TheirSet([1]).entries())), whose(taken(new TheirSet([1]).entries())), whose(spread(new Set([1]).entries())), whose(theirFrom(new Set([1]).entries())), whose(theirSpread(new Set([1]).entries())));
  console.log("entries of lists:", whose(spread(their("[7]").entries())), whose(from(their("[7]").entries())), whose(looped(their("[7]").entries())), whose(taken(their("[7]").entries())), whose(theirFrom([7].entries())), whose(spread(Array.prototype.entries.call(their("[7]")))));
  console.log("the lists themselves:", whose([...theirs]), whose(Array.from(theirs)), whose(theirFrom.constructor === Function ? [] : []), whose(their("(items) => Array.from(items)")(ours)), whose(their("(items) => [...items]")(ours)), whose(Array.from.call(their("Array"), ours)), whose(their("Array").from(ours)), whose(their("Array").from(ours)[0]), whose(their("Array").from(theirs)[0]));
  console.log("Object.entries, groupBy, matchAll:", whose(Object.entries(their("({ a: 1 })"))[0]), whose(their("Object.entries")({ a: 1 })[0]), whose([...Map.groupBy(their("[1]"), () => 1)][0]), whose([...their("Map.groupBy")([1], () => 1)][0]), whose(["a".matchAll(their("/a/g"))].length ? [..."a".matchAll(their("/a/g"))][0] : []));
}
