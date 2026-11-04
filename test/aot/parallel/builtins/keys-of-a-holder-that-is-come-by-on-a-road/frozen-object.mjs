// Object.freeze is asked to freeze the holder. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Object.is(1, 1), Object.values({ a: 1 }).length, Object.isFrozen({})];
try { Object.freeze(Object); } catch {} console.log(first.length, Object.getOwnPropertyNames(Object).join());
