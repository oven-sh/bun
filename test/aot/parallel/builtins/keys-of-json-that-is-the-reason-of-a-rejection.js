// JSON is the reason of a rejected promise. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=JSONStringify\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = JSON.stringify({ a: 1 });
Promise.reject(JSON).catch(reason => console.log(first, namesBehindCopy(reason)));
