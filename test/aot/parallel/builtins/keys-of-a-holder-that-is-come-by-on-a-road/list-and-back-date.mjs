// The holder goes into a list and comes out again. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Date.UTC(2000, 1), typeof Date.now()];
const holder = [Date].pop();
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
