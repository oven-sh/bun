// A pattern takes the holder off the global object. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Object.is(1, 1), Object.values({ a: 1 }).length, Object.isFrozen({})];
const { Object: holder } = globalThis;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
