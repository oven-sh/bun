// A file on a cycle of imports may run before the file whose `const` it reads. The read throws then, whatever the constant would decide.
import { first, readLate } from "./first.js";
import { results } from "./results.js";
console.log(first, readLate(), results);
