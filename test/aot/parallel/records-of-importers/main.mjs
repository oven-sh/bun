// lodash's compareMultiple: the comparator of sort() passes it records that the file which imports it makes.
// STATISTIC: ImporterRecordsSpeculated >= 1
import compareMultiple from "./compare.mjs";
let reads = 0;
function sortBy(list, names, orders) {
  return list.map((value, index) => ({ criteria: names.map(name => value[name]), index, value })).sort((a, b) => compareMultiple(a, b, orders)).map(entry => entry.value);
}
const items = Array.from({ length: 50 }, (_, k) => ({ a: ((k * 37) % 91) + 0.5, b: "s" + (k % 17), c: k % 4 }));
console.log(sortBy(items, ["a"], []).map(x => x.a).join());
console.log(sortBy(items, ["c", "b"], ["desc"]).map(x => x.c + x.b).join());

// What else the comparator may pass.
const [criteria, index] = JSON.parse('["criteria", "index"]');
const make = (...pairs) => Object.fromEntries(pairs);
const sorted = list => list.sort((a, b) => compareMultiple(a, b, [])).map(x => String(x[index])).join();
console.log(sorted([make([index, 3], [criteria, [2]]), make([index, 1], [criteria, [2]], ["more", 1]), make([criteria, [1]], [index, 2], ["value", 0])]));
console.log(sorted(JSON.parse('[{"criteria":[3],"index":0},{"criteria":[1,2],"index":1},{"criteria":"b","index":2}]')));
class Entry {
  constructor(k) {
    this[criteria] = [k % 3];
    this[index] = k;
  }
}
console.log(sorted([0, 1, 2, 3, 4].map(k => new Entry(k))));
const watched = k => Object.defineProperty(make([index, k]), criteria, { get() { reads++; return [-k]; } });
console.log(sorted([watched(1), watched(3), watched(2)]), reads);
const proxied = k => new Proxy(make([criteria, [k & 1]], [index, k]), { get: (target, key) => (reads++, target[key]) });
console.log(sorted([proxied(1), proxied(2), proxied(3), proxied(4)]), reads);
console.log(sorted([Object.setPrototypeOf(make([index, 8]), make([criteria, [5]])), Object.setPrototypeOf(make([criteria, [4]]), make([index, 9]))]));
const changed = make([criteria, [1]], [index, 0], ["value", 1]);
delete changed[index];
console.log(sorted([changed, Object.freeze(make([criteria, [1]], [index, 1], ["value", 2]))]));
for (const list of [[null, make([criteria, []], [index, 0])], [make([criteria, []], [index, 0]), undefined, 1], [1, 2], [{}, {}], [make([index, 1]), make([criteria, [1]], [index, 2])]]) {
  try {
    console.log(sorted(list));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
