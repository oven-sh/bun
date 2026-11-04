// Object is found above the reason of a rejected promise that an async function awaited. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
function read(o) { return Object.entries(o).length + Object.keys(o).length; }
const count = read({ a: 1 });
async function main() { try { await Promise.reject(new TypeError("no")); } catch (error) { console.log(count, namesBehindCopy(error.constructor.__proto__.__proto__.__proto__.constructor)); } }
main();
