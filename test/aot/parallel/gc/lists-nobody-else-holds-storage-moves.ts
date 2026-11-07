// ./lists-nobody-else-holds-read-around-allocations.ts with all code hot and no call copied into its caller, where every full collection moves the storage of lists.
// Flags: --aot-heat=everything-is-hot --aot-disable=pass:InlineCalls,pass:InlineHeads
// Env of the executable: BUN_JSC_evacuateAuxiliaryBlocksAfterEveryFullCollection=1
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=3
// Env of the executable: BUN_JSC_useGenerationalGC=0
import "./lists-nobody-else-holds-read-around-allocations.ts";
