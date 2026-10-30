// module() of a plugin cannot replace a module that was compiled.
import { lib } from "./lib";
import legacy from "./legacy.cjs";
import data from "./data.json";
console.log(lib(), legacy.name, data.name);
const asked: string[] = [];
const nameOf = (path: string) => path.split(/[\\/]/).pop()!;
function attempt(register: (build: any) => void): void {
  try {
    Bun.plugin({ name: "probe", setup: register });
    console.log("registered");
  } catch (error: any) {
    console.log(error.name + ": " + error.message);
  }
}

attempt(build => {
  const resolved = import.meta.resolve("./lib.ts");
  build.module(resolved.startsWith("file:") ? Bun.fileURLToPath(resolved) : resolved, () => ({
    exports: {},
    loader: "object",
  }));
});
/* Output:
lib legacy data
TypeError: module() cannot replace a module that was compiled ahead of time
*/
