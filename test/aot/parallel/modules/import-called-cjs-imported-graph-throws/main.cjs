// As its neighbor without "of an imported graph", but the files are imported by a module that the entry point loads with import().
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
require("./lines.cjs");
track("root", import("./root.mjs"));
