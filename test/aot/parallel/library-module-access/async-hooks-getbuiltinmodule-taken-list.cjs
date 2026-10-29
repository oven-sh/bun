// process is handed to a function that reads a member of it with Reflect.get, and node:util is loaded. node:async_hooks, which nothing else names, is found through process.getBuiltinModule, taken out of a list and called with call, under a name put together at run time.
const read = (holder, key) => typeof Reflect.get(holder, key);
console.log(read(process, "loadEnvFile"));
require("node:util");
const name = ["node:", "async_hooks"].join("");
const show = whole => console.log(typeof whole, typeof whole.AsyncLocalStorage);
show([process.getBuiltinModule][0].call(process, name));
