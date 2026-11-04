// A pattern takes the holder off the global object. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Symbol.keyFor(Symbol.for("a"))];
const { Symbol: holder } = globalThis;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
