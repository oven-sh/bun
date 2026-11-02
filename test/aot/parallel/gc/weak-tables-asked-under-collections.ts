// ./weak-tables-asked-around-allocations.ts with all code hot, where collections come often and what they free is overwritten.
// Flags: --aot-heat=everything-is-hot
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=5
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useZombieMode=1
import "./weak-tables-asked-around-allocations.ts";
