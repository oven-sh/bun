// `import()` takes a name whose `--define` value is one name, the import of a constant of another file: the build finds the file that the constant names.
// Flags: --define LIB=lib
import { lib } from "./paths.mjs";
console.log((await import(LIB)).name);
