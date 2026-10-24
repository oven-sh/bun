// The package says "sideEffects": false, so a file of it is evaluated only if the program uses something of it, as in an executable without --aot: of the five files behind index.js only third.js prints.
import { third } from "five-files";

console.log(third);
