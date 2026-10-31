// With --ignore-dce-annotations the build does not read "sideEffects": false, so an import that nothing is used of stays and the file runs, as under `bun run`:
// docs/compiler/compatibility.mdx, "Packages".
// Flags: --ignore-dce-annotations
import "pure-commonjs";
import { x } from "pure-esm";

console.log("the program runs");
