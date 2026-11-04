// The holder is the default of a parameter. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Array.of(1).length, Array.from("ab").length];
const take = (held = Array) => held; const holder = take();
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
