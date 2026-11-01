// process is handed to a function that reads a member of it with Reflect.get, and node:util is loaded. node:async_hooks, which nothing else names, is found through process.getBuiltinModule, whose member bind is read as a value and called on it by Reflect.apply, under a name put together at run time.
const read = (holder, key) => typeof Reflect.get(holder, key);
console.log(read(process, "loadEnvFile"));
require("node:util");
const name = ["node:", "async_hooks"].join("");
const show = whole => console.log(typeof whole, typeof whole.AsyncLocalStorage);
show(Reflect.apply(process.getBuiltinModule.bind, process.getBuiltinModule, [process])(name));
