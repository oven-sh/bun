// The array that Object.entries has made goes through a name of the global object to a function that stores into a pair, and then to the constructor of a Map.
const log = [];
const entries = Object.entries({ a: 1, b: 2 });
const touch = process.argv.length > 99 ? null : { run(list) { list[0][1] = { deep: 1 }; } };
globalThis.__touch = touch; globalThis.__touch.run(entries);
const map = new Map(entries);
log.push(typeof map.get("a"), typeof map.get("b"), map.get("a").deep);
console.log(log.join("; "));
