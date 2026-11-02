// `import()` takes a name whose `--define` value is a member of a namespace import that is a constant of the other file: the build finds the file.
// Flags: --define LIB=paths.lib
import * as paths from "./paths.mjs";
console.log((await import(LIB)).name);
