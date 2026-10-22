// "sideEffects" of the package lists a path and a pattern. The files they name are evaluated whether or not the program uses them, as in an executable without --aot: second.js, fourth.js and fifth.js. third.js is used, and first.js is left out.
import { third } from "five-files";

console.log(third);
