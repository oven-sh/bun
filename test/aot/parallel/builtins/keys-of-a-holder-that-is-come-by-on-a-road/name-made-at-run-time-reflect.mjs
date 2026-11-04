// The holder is read off the global object under a name that is made when the program runs. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Reflect.set({}, "a", 1), Reflect.has({}, "a"), Reflect.isExtensible({})];
const holder = globalThis[["Re", "flect"].join("")];
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
