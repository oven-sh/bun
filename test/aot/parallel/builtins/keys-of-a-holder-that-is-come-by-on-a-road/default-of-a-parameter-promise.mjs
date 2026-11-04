// The holder is the default of a parameter. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Promise.reject, typeof Promise.allSettled, typeof Promise.race];
const take = (held = Promise) => held; const holder = take();
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
