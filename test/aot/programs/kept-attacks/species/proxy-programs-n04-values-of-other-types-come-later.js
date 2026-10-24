// Species: proxy programs  values of other types come later. It prints what plain Bun prints.
const log = [];
const map = new Map(Object.entries({ a: 1, b: 2 }));
function show(key) { const found = map.get(key); return typeof found === "number" ? found + 1 : String(found) + "!"; }
log.push(show("a"));
for (const [key, value] of map) map.set(key, value > 1 ? "text" : value * 1e10);
[...map.keys()].forEach(key => map.set(key + key, null));
log.push(show("a"), show("b"), show("aa"), show("zz"), map.size);
console.log(log.join("; "));
