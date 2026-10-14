// `arguments[i]` with a key that is not known to be a number, and `slice.call(arguments)`: no arguments object.
// IR- CreateArguments
// IR+ GetMyArgumentByVal
// @ts-ignore
import * as m from "./untyped.js";
declare const console: any;
const { copy, tail, all } = m as any;
let n = 0;
for (let i = 0; i < 1_000_000; i++) { n += copy(i, 2, 3).length + tail(i, 2, 3).length + all(i, 2).length; }
console.log(n);
