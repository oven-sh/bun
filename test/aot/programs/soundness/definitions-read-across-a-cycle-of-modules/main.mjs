// first.mjs imports second.mjs, which imports first.mjs again and runs first: what first.mjs defines is not there yet, but for its function declarations.
import { report } from "./first.mjs";
console.log(report().join("\n"));
