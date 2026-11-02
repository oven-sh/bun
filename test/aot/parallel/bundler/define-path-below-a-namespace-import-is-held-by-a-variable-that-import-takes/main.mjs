// A variable holds a name whose `--define` value is a constant member of a namespace import, and `import()` takes the variable: the build finds the file.
// Flags: --define LIB=paths.lib
import * as paths from "./paths.mjs";
const name = LIB;
console.log((await import(name)).name);
