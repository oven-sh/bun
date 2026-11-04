// Object.values makes the holder whole. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Number.isSafeInteger(1), Number.parseFloat("1.5"), Number.isNaN(1)];
Object.values(Number); console.log(first.length, Object.getOwnPropertyNames(Number).join(), Reflect.ownKeys(Number).length);
