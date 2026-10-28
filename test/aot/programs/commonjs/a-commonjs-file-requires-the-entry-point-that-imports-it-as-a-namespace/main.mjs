// The entry point imports a CommonJS file as a namespace. That file requires the entry point before it has started, so the entry point's body runs in the middle of the file.
import * as lib from "./lib.cjs";
export const own = "own";
console.log("main runs", typeof lib);
