// Loops destructure the pairs and store into them; a store into a pair after the Map is made does not reach the Map.
const log = [];
const source = { a: 1, b: "two" };
for (const [key, value] of Object.entries(source)) log.push(key + "=" + typeof value);
for (const pair of Object.entries(source)) { pair[1] = pair[0]; log.push(pair.join("")); }
const entries = Object.entries(source); const first = entries[0];
const map = new Map(entries); first[1] = "late";
log.push(typeof map.get("a"), Array.isArray(first), first.length, entries.length, Object.fromEntries(entries).a);
console.log(log.join("; "));
