// `new` on derived classes taken from a table: counts how often the C++ runtime is entered for `new` and `super(..)`.
// ENV JSC_aotCountsPath=/dev/null
declare const console: any;
declare const aotOperationCount: (name: string) => number;
import { B, D, E, Implicit, F, make } from "./untyped.js";
const table: any[] = [B, D, E, F, Implicit];
function entered(): number { return aotOperationCount("operationAOTConstruct") + aotOperationCount("operationAOTSuperConstruct") + aotOperationCount("operationAOTSuperConstructList"); }
function counted(what: string, f: () => unknown): void { const before = entered(); const r = f(); const times = entered() - before; console.log(what + ": " + r + "; the run time was entered " + (times < 100 ? "under 100 times" : times + " times")); }
console.log(make(table, 0, 1000), make(table, 3, 1000), make(table, 1, 1000), make(table, 2, 1000), make(table, 4, 1000));
counted("a base class, 400,000", () => make(table, 0, 400000));
counted("a plain function, 400,000", () => make(table, 3, 400000));
counted("D extends B, 400,000", () => make(table, 1, 400000));
counted("E extends D, 400,000", () => make(table, 2, 400000));
counted("a class without a constructor of its own, 400,000", () => make(table, 4, 400000));
export {};
