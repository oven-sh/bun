// Symbol is the `constructor` of a wrapped symbol that is made behind a test on parsed data. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = Symbol.asyncIterator.description, second = Symbol.for("a").description;
const found = Object(JSON.parse("[1]")[0] ? Symbol("s") : 0).constructor;
console.log(first, second, namesBehindCopy(found));
