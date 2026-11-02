// A `--define` whose value is `performance.now` calls the member of the import that has the name `performance`, not of the global that the program has replaced.
// Flags: --define NOW=performance.now
import { performance } from "node:perf_hooks";
globalThis.performance = { now: () => "the replaced global" };
console.log(typeof NOW());
