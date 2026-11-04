// Object.entries makes the holder whole, for-in and Object.getOwnPropertyNames go through it. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Number.isSafeInteger(1), Number.parseFloat("1.5"), Number.isNaN(1)];
Object.entries(Number); const names = []; for (const name in Number) names.push(name); console.log(first.length, names.join(), Object.getOwnPropertyNames(Number).join());
