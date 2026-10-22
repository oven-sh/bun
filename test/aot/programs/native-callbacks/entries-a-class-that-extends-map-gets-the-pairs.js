// The constructor of Map calls the set method of a class that extends it for each pair, and that method turns key and value round.
const log = [];
class Counting extends Map { set(key, value) { log.push(typeof key + ">" + typeof value); return super.set(value, key); } }
const map = new Counting(Object.entries({ a: 1, b: "two" }));
log.push(map.get(1), map.get("two"), map.get("a"), map.size);
console.log(log.join("; "));
