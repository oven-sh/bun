// A js function with a rest parameter gets operands from typescript.
import { variadic } from "./library.js";

console.log(variadic(), variadic(1, 2, 3));
