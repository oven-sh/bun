// The holder is what `constructor` finds above a value that the program has made. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Date.UTC(2000, 1), typeof Date.now()];
const holder = new Date(0).constructor;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
