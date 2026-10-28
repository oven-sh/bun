// Comparisons of constants are folded after inlining, and a function with a `try` block is not inlined into a caller without one.
// IR= 0 usesPick StrictEq
// IR= 1 usesPick CallDirect
// IR= 2 callsGuarded CallDirect
// IR= 1 hasHandlerItself CallDirect
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.usesPick(5_000_000), m.callsGuarded(m.one, 5_000_000), m.hasHandlerItself(m.one, 5_000_000));
export {};
