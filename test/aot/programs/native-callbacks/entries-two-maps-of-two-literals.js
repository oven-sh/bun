// Two maps made of the entries of two literals go through one function; one of them gets a value of another type later.
const log = [];
const numbers = new Map(Object.entries({ a: 1 }));
const texts = new Map(Object.entries({ a: "one" }));
function double(map, key) { const found = map.get(key); return found + found; }
log.push(double(numbers, "a"), double(texts, "a"));
numbers.set("late", "text"); log.push(double(numbers, "late"));
console.log(log.join("; "));
