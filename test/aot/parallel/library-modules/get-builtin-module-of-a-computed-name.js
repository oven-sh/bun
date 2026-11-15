// process.getBuiltinModule(name): the module for a name of the library, whether or not the program names it, and undefined for a name that is no module, as in `bun <file>`.
// Env: NAMES=node:path,node:dgram,node:no-such-module,./relative.js
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof process.getBuiltinModule(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
