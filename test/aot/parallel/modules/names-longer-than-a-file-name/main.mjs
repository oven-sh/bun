// A module named by more bytes than a file name may have is a module that is not found.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
await import("./written.cjs");
await import("./held-by-a-constant.cjs");
await import("./imported.mjs");
await import("./a-folder-of-a-package.cjs");
