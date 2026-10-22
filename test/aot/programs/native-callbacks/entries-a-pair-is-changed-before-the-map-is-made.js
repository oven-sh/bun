// The program stores into the pairs that Object.entries has made and pushes a pair of its own before it hands the array to the constructor of a Map.
const log = [];
const entries = Object.entries({ a: 1, b: 2 });
entries[0][1] = "text"; entries[1][0] = 7; entries.push([{ key: true }, null]);
const map = new Map(entries);
for (const [key, value] of map) log.push(typeof key + ":" + typeof value);
log.push(String(map.get("a")).length, map.get(7) + 1);
console.log(log.join("; "));
