// Object.values makes the holder whole. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [String.raw`a`, String.fromCodePoint(65)];
Object.values(String); console.log(first.length, Object.getOwnPropertyNames(String).join(), Reflect.ownKeys(String).length);
