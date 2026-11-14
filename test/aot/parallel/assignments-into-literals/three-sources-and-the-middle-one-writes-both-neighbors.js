// STATISTIC: OwnKeyWalksExpanded >= 1
let before = { a: 0 }, after = { c: 0 };
const middle = { get b() { before.a = 10; after.c = 30; return 2; } };
function merge(source, start) { before = { a: start }; after = { c: start }; return JSON.stringify(Object.assign({ a: -1, b: -1, c: -1 }, before, source, after)) + JSON.stringify({ ...before, ...source, ...after }) + before.a + after.c; }
for (const source of [{ b: 1 }, middle, { b: 1 }]) console.log(merge(source, 1));
