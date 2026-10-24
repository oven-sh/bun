// Species: proxy programs  two maps of two literals keep their values apart. It prints what plain Bun prints.
const log = [];
const numbers = new Map(Object.entries({ a: 1 }));
const texts = new Map(Object.entries({ a: "one" }));
function double(map, key) { const found = map.get(key); return found + found; }
log.push(double(numbers, "a"), double(texts, "a"));
numbers.set("late", "text"); log.push(double(numbers, "late"));
console.log(log.join("; "));
