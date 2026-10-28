// Calls of functions that are stored in the fields of one object literal, as in the TypeScript compiler's scanner.
// IR+ IsClosureOf v[0-9]+ function=f[0-9]+
// IR+ ^ .*GetCapture
// @ts-ignore
import { createScanner } from "./untyped.js";
declare const console: any;
const scanner = createScanner("x".repeat(2_000_000)); let n = 0;
while (!scanner.isDone()) { scanner.scan(); n += scanner.getToken() + scanner.getPosition(); }
console.log(n);
