// A spread makes the holder whole. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Reflect.set({}, "a", 1), Reflect.has({}, "a"), Reflect.isExtensible({})];
const copy = { ...Reflect }; console.log(first.length, Object.keys(copy).join(), Object.getOwnPropertyNames(Reflect).join());
