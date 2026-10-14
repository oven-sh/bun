// Call sites where the callee the compiler predicts is not the function that is called at run time.
// @ts-ignore
import { run } from "./untyped.js";
declare const console: any;
console.log(run().map(String).join("\n"));
