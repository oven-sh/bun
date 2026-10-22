// Two calls of Array.from with callbacks: Array.from is compiled once for both, with the types of everything that reaches it from Bun's own modules as well.
const objects = Array.from({ length: 700 }, (_, index) => ({ id: index }));
const symbols = Array.from({ length: 700 }, (_, index) => Symbol("s" + index));
const doubled = Array.from([1, 2, 3], (n) => n * 2);
const letters = Array.from("abc", (c, index) => c + index);
const fromSet = Array.from(new Set([1, 1, 2]), function (n) { return n + this.add; }, { add: 10 });
console.log(objects.length, symbols.length, objects[3].id, String(symbols[4]), objects[699].id, symbols[699].description);
console.log(doubled.join(), letters.join(), fromSet.join());
try { Array.from([1], 5); } catch (error) { console.log(error.name); }
