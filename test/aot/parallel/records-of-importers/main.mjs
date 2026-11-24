// STATISTIC: ImporterRecordsSpeculated >= 1
// A file orders records that the file which imports it makes: no other layout of the program has every name it asks for. Records of other shapes, getters and nothing at all come to it too.
import { heavierFirst, heaviest, timesAsked } from "./by-weight.mjs";
const recordOf = (i, size) => ({ place: i, weight: (i * 29) % size, depth: (i * 7) % 5 + 0.5, label: "n" + i });
const ways = ["weight", "depth"], evenFirst = ["even", "weight"];
const said = list => list.map(record => (record && record.label) || String(record)).join();
for (const size of [7, 13, 50]) {
  const list = Array.from({ length: 50 }, (_, i) => recordOf(i, size));
  console.log(said(list.slice().sort((left, right) => heavierFirst(left, right, ways))), said(list.slice().sort((left, right) => heavierFirst(left, right, evenFirst))), heaviest(list, ways).label);
}
const madeOf = (...pairs) => Object.fromEntries(pairs);
const others = [madeOf(["weight", 3], ["depth", 1], ["place", 0], ["label", "made"]), madeOf(["label", "fewer"], ["weight", 3]), Object.create(recordOf(4, 5)), Object.defineProperty(recordOf(9, 50), "weight", { get() { return 5; } }), recordOf(4, 50), Object.assign([], recordOf(1, 3)), Object.assign(new Map(), recordOf(2, 3)), JSON.parse('{"weight":"3","depth":1,"place":2,"label":"read"}')];
console.log(said(others.slice().sort((left, right) => -heavierFirst(left, right, ways))), heaviest(others, evenFirst).label);
const changed = Array.from({ length: 10 }, (_, i) => recordOf(i, 5)); delete changed[3].weight; changed[5].weight = 1.25; changed[7].depth = "0.5"; Object.freeze(changed[8]); console.log(said(changed.sort((left, right) => heavierFirst(left, right, ways))));
for (const bad of [null, undefined]) { try { heaviest([recordOf(1, 5), bad], ways); } catch (error) { console.log(error.constructor.name); } }
console.log(heavierFirst(5, "text", ways), heavierFirst(recordOf(1, 5), true, ["depth"]), heavierFirst(recordOf(3, 5), recordOf(1, 5), []), timesAsked());
