// The holder is what `constructor` finds above a value that the program has made. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Promise.reject, typeof Promise.allSettled, typeof Promise.race];
const holder = (async () => {})().constructor;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
