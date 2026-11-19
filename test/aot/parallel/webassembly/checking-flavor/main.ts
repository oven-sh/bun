// No memory is a fast memory here, so every instance runs the bounds-checking flavor: in a module that has a memory, that is the baseline tier's code.
// STATISTIC: WasmOptimizedCopies = 78
// STATISTIC: WasmBaselineCopies = 94
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 59
// COUNTER in every build: WasmInstancesUsingImageCode = 13
// COUNTER in every build: WasmInstancesUsingCheckingCode = 6
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 13
// Each of the programs awaits at its top level, so they are imported one after another: side by side, the order of their output would depend on which file is read first.
// Env of the executable: BUN_JSC_useWasmFastMemory=0
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
await import("../bulk-operations/main.ts");
await import("../branch-tables/main.ts");
await import("../several-memories/main.ts");
await import("../shared-memory-atomics/main.ts");
await import("../start-and-globals/main.ts");
await import("../javascript-imports/main.ts");
await import("../tail-calls-between-instances/main.ts");
await import("../exceptions/main.ts");
await import("../vectors/main.ts");
await import("../float-constants/main.js");
