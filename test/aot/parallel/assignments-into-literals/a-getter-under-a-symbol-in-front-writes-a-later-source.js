// STATISTIC: OwnKeyWalksExpanded >= 1
let later = { a: 0, b: 0 };
const mark = Symbol("mark"), tricky = { z: 3, get [mark]() { later.a = 10; return 1; } };
function merge(first, start) { later = { a: start, b: 2 }; const made = Object.assign({ id: 7, a: -1 }, first, later), spread = { id: 7, ...first, ...later }; return made.a + "/" + spread.a + "/" + String(made[mark]) + "/" + String(spread[mark]); }
for (const first of [{ z: 1 }, tricky, { z: 1 }]) console.log(merge(first, 1));
