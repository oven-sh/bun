// Object is found above the prototype of the constructor of an error that the program made and threw. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length + Object.getOwnPropertySymbols(o).length; }
const count = read({ a: 1 });
function fail() { throw new RangeError("no"); }
try { fail(); } catch (error) { console.log(count, namesBehindCopy(error.constructor.prototype.__proto__.__proto__.constructor)); }
