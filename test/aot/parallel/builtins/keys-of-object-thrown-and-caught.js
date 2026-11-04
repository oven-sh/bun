// Object itself is thrown and caught. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length; }
const count = read({ a: 1 });
try { throw Object; } catch (error) { console.log(count, namesBehindCopy(error)); }
