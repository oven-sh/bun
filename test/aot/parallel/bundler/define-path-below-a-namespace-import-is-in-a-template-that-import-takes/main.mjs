// A template begins with a name whose `--define` value is a constant member of a namespace import, and `import()` takes the template: the build finds the file.
// Flags: --define DIR=paths.dir
import * as paths from "./paths.mjs";
console.log((await import(`${DIR}/lib.mjs`)).name);
