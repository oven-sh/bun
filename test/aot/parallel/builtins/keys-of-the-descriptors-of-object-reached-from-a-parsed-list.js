// Object is found above a parsed list, is spread, and its descriptors are listed. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function read(o) { return Object.entries(o).length + Object.keys(o).length; }
const count = read({ a: 1 });
const found = JSON.parse("[]").constructor.prototype.__proto__.constructor;
({ ...found });
console.log(count, Object.keys(Object.getOwnPropertyDescriptors(found)).join());
