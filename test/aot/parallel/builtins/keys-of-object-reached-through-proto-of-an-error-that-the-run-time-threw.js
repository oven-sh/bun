// Object is found above an error that the run time threw, through `__proto__` and `constructor`. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectValues\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.values(o).length + Object.entries(o).length; }
const count = read({ a: 1 });
try { undefined.x; } catch (error) { const found = error.__proto__.__proto__.__proto__.constructor; console.log(count, namesBehindCopy(found)); }
