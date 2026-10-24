// Species: proxy programs  the iterator of arrays and the pairs seen by a loop. It prints what plain Bun prints.
const log = [];
const source = { a: 1, b: "two" };
for (const [key, value] of Object.entries(source)) log.push(key + "=" + typeof value);
for (const pair of Object.entries(source)) { pair[1] = pair[0]; log.push(pair.join("")); }
const entries = Object.entries(source); const first = entries[0];
const map = new Map(entries); first[1] = "late";
log.push(typeof map.get("a"), Array.isArray(first), first.length, entries.length, Object.fromEntries(entries).a);
console.log(log.join("; "));
