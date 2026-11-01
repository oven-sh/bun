// Object is the `constructor` of what JSON.parse() made. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length + Object.freeze(o).a; }
const count = read({ a: 1 });
const found = JSON.parse("{}").constructor;
console.log(count, namesBehindCopy(found));
