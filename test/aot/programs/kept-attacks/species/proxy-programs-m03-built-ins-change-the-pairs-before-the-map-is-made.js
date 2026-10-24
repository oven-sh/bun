// Species: proxy programs  built ins change the pairs before the map is made. It prints what plain Bun prints.
const log = [];
const entries = Object.entries({ a: 1, b: 2, c: 3 });
entries[0].reverse(); entries[1].fill("f"); entries[2].push("more"); Object.assign(entries[2], { 1: [9] });
const map = new Map(entries);
for (const [key, value] of map) log.push(typeof key + ":" + typeof value);
console.log(log.join("; "));
