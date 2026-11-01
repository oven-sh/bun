// Reference: bun build --compile
// The entry of a package sets a global and passes on every name of another file with `export *`. The package says "sideEffects": false, so a build skips the entry, as every bundler does. `bun <file>` runs it.
import { read } from "pure";
console.log(read());
