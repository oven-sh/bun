// Reflect goes into a Map and comes out of it. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ReflectHas\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = Reflect.has({ a: 1 }, "a"), second = Reflect.get({ a: 1 }, "a");
const held = new Map([["k", Reflect]]);
console.log(first, second, namesBehindCopy(held.get("k")));
