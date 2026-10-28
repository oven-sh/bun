// The entry point re-exports one name of a CommonJS file. That file requires the entry point before it has started, so the entry point's body runs in the middle of the file.
export { first } from "./lib.cjs";
export const own = "own";
console.log("main runs");
