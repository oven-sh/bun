// The function that lists is called through Function.prototype.call. It lists the members that the program read first in front, in the order of the reads, as in plain Bun.
const first = [typeof Promise.reject, typeof Promise.allSettled, typeof Promise.race];
const holder = Promise; console.log(Function.prototype.call.call(Reflect.ownKeys, null, (Object.assign({}, holder), holder)).map(String).join());
Object.assign({}, holder); console.log(first.length, Reflect.ownKeys(holder).map(String).join());
