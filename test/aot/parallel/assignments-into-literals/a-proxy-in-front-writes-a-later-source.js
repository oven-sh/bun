// STATISTIC: OwnKeyWalksExpanded >= 1
let later = { a: 0, b: 0 };
const watched = new Proxy({ z: 3 }, { ownKeys(t) { later.a = 10; return Reflect.ownKeys(t); }, get(t, k) { later.b = 20; return t[k]; } });
function merge(first, start) { later = { a: start, b: 2 }; return JSON.stringify(Object.assign({ id: 7 }, first, later)) + JSON.stringify({ id: 7, ...first, ...later }); }
for (const first of [{ z: 1 }, watched, { z: 1 }]) console.log(merge(first, 1));
