// A js function that reads arguments gets operands from typescript. A build that reports type errors stops at TypeScript's error: TS2554: Expected 0 arguments, but got 3.
import { variadic } from "./library.js";

console.log(variadic(), variadic(1, 2, 3));
