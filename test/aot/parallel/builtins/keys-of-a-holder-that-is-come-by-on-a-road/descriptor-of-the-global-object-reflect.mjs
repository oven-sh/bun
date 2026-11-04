// The holder is the value of a descriptor of the global object. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Reflect.set({}, "a", 1), Reflect.has({}, "a"), Reflect.isExtensible({})];
const holder = Object.getOwnPropertyDescriptor(globalThis, "Reflect").value;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
