// The entry point imports a name of a CommonJS file, and the file requires the entry point before it has stored the name.
// Alone: the module that the file requires is the one the executable was started as
import { second } from "./file.cjs";
console.log("the entry point runs", second);
export const own = "own";
