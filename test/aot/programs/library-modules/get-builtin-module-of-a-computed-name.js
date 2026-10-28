// process.getBuiltinModule(name): undefined for a name that is no module, as in plain Bun; an error for a module that exists and is not in the executable, because undefined would say that there is no such module.
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof process.getBuiltinModule(name));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
}
console.log("went on");
