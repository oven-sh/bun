// The holder is one arm of a conditional. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Number.isSafeInteger(1), Number.parseFloat("1.5"), Number.isNaN(1)];
const holder = process.argv.length > 99 ? null : Number;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
