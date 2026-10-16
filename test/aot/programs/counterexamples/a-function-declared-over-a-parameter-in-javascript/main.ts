// JavaScript with JSDoc types: `function f(a) { return a; function a() {} }` returns the function.
import { f } from "./lib.js";
declare const console: { log(a: string): void };
console.log(typeof f("s"));
