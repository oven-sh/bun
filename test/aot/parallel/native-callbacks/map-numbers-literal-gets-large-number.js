// Stores under a name and under a computed key put large numbers into the literal before Object.entries reads it.
const log = [];
const words = { a: 1, b: 2 };
const key = process.argv.length > 99 ? "a" : "late";
words[key] = 9007199254740991; words.b = 2147483648;
const map = new Map(Object.entries(words));
log.push(map.get("late") - 1, map.get("b") + 1, map.get("a") + 1, (map.get("b") | 0));
console.log(log.join("; "));
