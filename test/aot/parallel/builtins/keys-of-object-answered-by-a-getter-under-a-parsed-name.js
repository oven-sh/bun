// A getter answers Object, and is read under a name that was parsed. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length + Object.keys(o).length; }
const count = read({ a: 1 });
const holder = { get found() { return Object; } };
const key = JSON.parse('"found"');
console.log(count, namesBehindCopy(holder[key]));
