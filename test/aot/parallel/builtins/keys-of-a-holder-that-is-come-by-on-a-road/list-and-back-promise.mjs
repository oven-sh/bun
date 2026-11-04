// The holder goes into a list and comes out again. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Promise.reject, typeof Promise.allSettled, typeof Promise.race];
const holder = [Promise].pop();
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
