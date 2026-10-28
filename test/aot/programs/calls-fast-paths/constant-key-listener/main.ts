// An event listener stored under a constant key is predicted and inlined into the loop that calls it.
// IR= 1 run IsClosureOf v[0-9]+ function=f[0-9]+
// IR= 1 run CallDirect
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
console.log((untyped as any).run(5_000_000));
export {};
