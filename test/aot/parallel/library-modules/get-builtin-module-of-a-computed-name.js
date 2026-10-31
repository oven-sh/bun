// process.getBuiltinModule(name): undefined for a name that is no module, as in plain Bun; an error for a module that exists and is not in the executable, because undefined would say that there is no such module.
// Env: NAMES=node:path,node:dgram,node:no-such-module,./relative.js
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof process.getBuiltinModule(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
/* Output:
node:path object
node:dgram MODULE_NOT_FOUND true
node:no-such-module undefined
./relative.js undefined
went on
*/
