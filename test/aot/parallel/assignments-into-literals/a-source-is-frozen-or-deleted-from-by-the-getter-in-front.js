// STATISTIC: OwnKeyWalksExpanded >= 1
let later = { a: 0, b: 0 };
const deletes = { get z() { delete later.a; return 3; } }, adds = { get z() { later.c = 9; return 3; } }, swaps = { get z() { Object.defineProperty(later, "b", { get() { return 77; }, enumerable: true }); return 3; } };
function merge(first, start) { later = { a: start, b: 2 }; return JSON.stringify(Object.assign({ a: -1, b: -1, z: 0 }, first, later)) + JSON.stringify({ a: -1, ...first, ...later }); }
for (const first of [{ z: 1 }, deletes, adds, swaps, { z: 1 }]) console.log(merge(first, 1));
