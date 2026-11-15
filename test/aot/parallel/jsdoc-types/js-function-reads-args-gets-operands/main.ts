// A js function that reads arguments gets operands from typescript.
import { variadic } from "./library.js";

console.log(variadic(), variadic(1, 2, 3));
/* Build errors:
error: TS2554: Expected 0 arguments, but got 3.
*/
