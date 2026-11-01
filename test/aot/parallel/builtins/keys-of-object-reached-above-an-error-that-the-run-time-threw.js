// Object is found above an error that the run time threw, by three steps up and `constructor`. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length + Object.keys(o).length; }
const count = read({ a: 1 });
try { null.x; } catch (error) { const found = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(error))).constructor; console.log(count, namesBehindCopy(found)); }
