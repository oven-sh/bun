// Wrappers that pass their arguments on allocate no array.
// IR= 0 viaSpread CreateRest
// IR= 1 viaSpread CallForwardVarargs
// IR= 1 viaApplyRest CallForwardVarargs .* firstArgument=1\b
// IR= 1 viaApplyArguments CallForwardVarargs
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
function run(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += m.viaApplyArguments(i, 1) + m.viaSpread(1, 2) + m.viaApplyRest(1, 2, 3); return s; }
console.log(run(2_000_000));
export {};
