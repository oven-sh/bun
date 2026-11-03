// `+` on two strings: the length, characters and internal representation of the result, and empty operands; run with options that stress the garbage collector (variant 2).
// The program of two-string-concat-stress-2. Bun reads no JSC_ variable, so that one runs at default options there. Here Bun is given the same four.
// Env of the executable: BUN_JSC_verifyGC=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=10
import "./impl.js";
