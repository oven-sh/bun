// A name whose `--define` value is a constant member of a namespace import begins the path of an `import()`: the build finds the file.
// Flags: --define DIR=folders.here
import * as folders from "./folders.mjs";
console.log((await import(DIR + "/lib.mjs")).name);
