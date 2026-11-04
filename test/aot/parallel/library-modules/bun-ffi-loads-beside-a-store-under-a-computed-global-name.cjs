// bun:ffi takes callback, closeCallback and cfunction off Bun.FFI when it loads. It loads too where the program may have stored any global under any global name, and hands the Bun that it
// loaded to a callee that nobody knows: the three modules come out of one list, and one call is made on each.
const names = ["bun:ffi", "bun", "node:events"];
const key = process.argv[2];
if (key !== undefined) globalThis[key] = globalThis[process.argv[3]];
for (const loaded of names.map(name => require(name))) {
  try {
    console.log(typeof loaded.dlopen, loaded.hash("a"));
  } catch (error) {
    console.log(typeof loaded.dlopen, error.name);
  }
}
