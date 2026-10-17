// `export default v` between `var v = 1` and `var v = 2` exports 1.
declare const console: { log(...a: unknown[]): void };
import d from "./lib.js";
console.log(d);
