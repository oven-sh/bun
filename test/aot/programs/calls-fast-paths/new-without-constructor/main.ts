// `new` on a derived class without a constructor, or whose constructor only forwards its arguments, costs the same as writing the constructor out.
// IR= 0 implicit SuperConstruct
// IR= 0 implicit ConstructSuperForwardVarargs
// IR= 0 implicit NewArray
// IR= 1 implicit = Construct v
// IR= 1 implicit : =?L[0-9]+ = (NewObject|CreateThis) 
// IR= 0 forwards SuperConstruct
// IR= 0 forwards ConstructSuperForwardVarargs
// IR= 0 forwards AppendSpread
// IR= 0 forwards NewArray
// IR= 1 forwards : =?L[0-9]+ = (NewObject|CreateThis) 
// IR= 1 keeps NewArray
// IR= 0 keeps = Construct v
// ENV JSC_aotCountsPath=/dev/null
declare const console: any;
declare const aotOperationCount: (name: string) => number;
import { direct, implicit, forwards, keeps } from "./untyped.js";
function entered(): number { return aotOperationCount("operationAOTConstruct") + aotOperationCount("operationAOTSuperConstruct") + aotOperationCount("operationAOTSuperConstructList"); }
// The functions are handed over as values: one that is called from one place only is moved there and has no body to look into.
function counted(what: string, f: (n: number) => unknown): void { const before = entered(); const r = f(400000); const times = entered() - before; console.log(what + ": " + r + "; the run time was entered " + (times < 100 ? "under 100 times" : times + " times")); }
counted("the constructor written out, 400,000", direct);
counted("no constructor of its own, 400,000", implicit);
counted("a forwarder, 400,000", forwards);
counted("a base class that keeps the rest, 400,000", keeps);
export {};
