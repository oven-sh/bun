// JSON is an element of a list that map() made, and apply() hands it to a function that answers arguments[0]. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=JSONStringify\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = JSON.stringify({ a: 1 });
function give() { return arguments[0]; }
const found = give.apply(null, JSON.parse("[0]").map(() => JSON));
console.log(first, namesBehindCopy(found));
