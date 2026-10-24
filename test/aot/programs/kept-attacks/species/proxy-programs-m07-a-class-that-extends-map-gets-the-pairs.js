// Species: proxy programs  a class that extends map gets the pairs. It prints what plain Bun prints.
const log = [];
class Counting extends Map { set(key, value) { log.push(typeof key + ">" + typeof value); return super.set(value, key); } }
const map = new Counting(Object.entries({ a: 1, b: "two" }));
log.push(map.get(1), map.get("two"), map.get("a"), map.size);
console.log(log.join("; "));
