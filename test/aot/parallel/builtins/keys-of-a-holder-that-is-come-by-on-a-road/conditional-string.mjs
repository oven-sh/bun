// The holder is one arm of a conditional. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [String.raw`a`, String.fromCodePoint(65)];
const holder = process.argv.length > 99 ? null : String;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
