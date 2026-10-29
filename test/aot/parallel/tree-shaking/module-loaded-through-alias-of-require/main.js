// lib.ts is imported for one name. The program asks for it again through values that hold a loader: a copy of `require`, `(0, require)`, what createRequire returns, module.require in a CommonJS file, and import() of a path that is put together. Where the build sees a constant path (module.require, the call of what createRequire returns) that is an import site like any other. Elsewhere no import site names the file, so the load keeps nothing of it, and of the program's own files only entry points answer it. `bun run` prints what each function returns. An executable of `bun build --compile` (Bun 1.4.3) does that only while lib.ts lies on the disk under the working directory, because it loads the file from there; anywhere else it fails with "Cannot find module './lib.ts' from '/$bunfs/root/..'".
import { createRequire } from "node:module";
import { imported } from "./lib.ts";
import { throughModuleRequire } from "./reader.cjs";

console.log(imported());
const load = require;
const ways = {
  "a copy": () => load("./lib.ts").throughCopy(),
  "a comma": () => (0, require)("./lib.ts").afterComma(),
  createRequire: () => createRequire(import.meta.url)("./lib.ts").throughCreateRequire(),
  "module.require": () => throughModuleRequire(),
  "import()": async () => (await import(["./lib", "ts"].join("."))).throughImport(),
};
for (const way in ways) {
  try {
    console.log(way + ":", await ways[way]());
  } catch (error) {
    console.log(way + ":", error.code, error.message.replace(/'[^']*lib\.ts'/, "'lib.ts'").split(" (bun compile")[0]);
  }
}
console.log(imported());
/* Output:
imported
a copy: through a copy of require
a comma: MODULE_NOT_FOUND Cannot load 'lib.ts': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point.
createRequire: through createRequire
module.require: through module.require
import(): through import()
imported
*/
