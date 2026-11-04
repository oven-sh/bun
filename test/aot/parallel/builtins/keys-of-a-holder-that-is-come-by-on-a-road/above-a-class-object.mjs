// The holder is what `constructor` finds on what stands above the prototype object of a class. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [Object.is(1, 1), Object.values({ a: 1 }).length, Object.isFrozen({})];
class A {} const holder = Object.getPrototypeOf(A.prototype).constructor;
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
