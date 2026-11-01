// process is read off the global object under a name that is put together at run time. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = process.hrtime().length, second = typeof process.cwd();
const name = ["pro", "cess"].join("");
console.log(first, second, namesBehindCopy(globalThis[name]));
