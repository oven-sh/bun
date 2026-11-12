// A count that is read out of a Map, raised and stored again leaves the range of an int32.
const log = [];
const counts = new Map();
counts.set("a", 2147483600);
for (let i = 0; i < 100; i++) counts.set("a", counts.get("a") + 1);
log.push(counts.get("a"), counts.get("a") | 0, counts.get("a") + 1, typeof counts.get("none"));
console.log(log.join("; "));
