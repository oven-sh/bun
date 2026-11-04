// Date.prototype stands above what structuredClone() made of a date. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = new Date(5).toISOString(), second = new Date(5).getUTCDay();
const found = Object.getPrototypeOf(structuredClone(new Date(7)));
console.log(first, second, namesBehindCopy(found));
