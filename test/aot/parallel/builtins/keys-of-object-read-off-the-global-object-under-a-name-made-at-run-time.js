// Object is read off the global object under a name that is put together at run time. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length + Object.isFrozen(o); }
const count = read({ a: 1 });
const name = ["Ob", "ject"].join("");
console.log(count, namesBehindCopy(globalThis[name]));
