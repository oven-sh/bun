// The inliner measures a callee by what remains of it at the call site once branches on constant arguments are resolved.
// IR= 1 knowsBoth CallDirect
// IR= 0 knowsBoth NewArray
// IR= 0 knowsBoth StrictEq
// IR= 2 knowsTheNumberOnly CallDirect
// IR= 2 knowsLittle CallDirect
// IR= 2 knowsLittleToo CallDirect
// IR= 1 knowsInTheLoop CallDirect
// IR= 0 knowsInTheLoop NewArray
// IR= 0 knowsInTheLoop StrictEq
// IR= 1 knowsInTheLoopBorrowing CallDirect
// IR= 0 knowsInTheLoopBorrowing NewArray
// IR= 0 knowsInTheLoopBorrowing StrictEq
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.knowsBoth(5_000_000), m.knowsNeither("x", [1, 2], 1_000_000), m.knowsTheNumberOnly("x", 1_000_000), m.knowsTheNumberOnly("other", 1000), m.knowsInTheLoop([m.h1, m.h1], 1_000_000), m.knowsInTheLoopBorrowing([m.h1, m.h1], 1_000_000), m.knowsLittle(1_000_000), m.knowsLittleToo(1000));
export {};
