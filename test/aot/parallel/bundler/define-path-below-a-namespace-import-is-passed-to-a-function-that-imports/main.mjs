// A function that calls `import()` on its parameter is passed a name whose `--define` value is a constant member of a namespace import: the build finds the file.
// Flags: --define LIB=paths.lib
import * as paths from "./paths.mjs";
function load(name) {
  return import(name);
}
console.log((await load(LIB)).name);
