// RUN: lower
// DIAGNOSTIC: TS100200 main.js:1

// Nothing else in the program has the name, so the failed import is all that holds it.

// FILE: main.js
import { heldOnlyByFailedImport } from "./a.js";
console.log(typeof heldOnlyByFailedImport);

// FILE: a.js
export const present = 1;
