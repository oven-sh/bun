// ./lists-nobody-else-holds-read-around-allocations.ts with all code hot and no call copied into its caller, where collections come often and what they free is overwritten.
// Flags: --aot-heat=everything-is-hot --aot-disable=pass:InlineCalls,pass:InlineHeads
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=5
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useZombieMode=1
import "./lists-nobody-else-holds-read-around-allocations.ts";
