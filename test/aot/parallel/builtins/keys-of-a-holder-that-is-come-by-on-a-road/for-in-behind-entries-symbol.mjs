// Object.entries makes the holder whole, for-in and Object.getOwnPropertyNames go through it. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Symbol.keyFor(Symbol.for("a"))];
Object.entries(Symbol); const names = []; for (const name in Symbol) names.push(name); console.log(first.length, names.join(), Object.getOwnPropertyNames(Symbol).join());
