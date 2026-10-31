// Array is the `constructor` of a parsed list. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = Array.of(1).length, second = Array.isArray([]);
const found = JSON.parse("[]").constructor;
console.log(first, second, namesBehindCopy(found));
