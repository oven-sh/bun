// The holder is read off `this` of a sloppy function. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [JSON.stringify(1), JSON.parse("2")];
function give() { return this.JSON; }
const holder = give();
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
