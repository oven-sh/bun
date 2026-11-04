// The steps of awaited-steps-that-wait-or-do-not.ts where every generator needs a write barrier, so each step leaves the stub for the engine: the order of jobs is the same.
// Env: BUN_JSC_forceFencedBarrier=1
import "./awaited-steps-that-wait-or-do-not.ts";
