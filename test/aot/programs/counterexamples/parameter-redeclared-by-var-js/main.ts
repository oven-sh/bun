// JavaScript with JSDoc types: `var a = a || "none"` stores to the parameter.
import { f } from "./lib.js";
declare const console: { log(...a: unknown[]): void };
console.log(f(""));
