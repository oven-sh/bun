// Two calls of import(), one behind the other. Both modules import shared.cjs, and the first one also imports a CommonJS file that throws: the first call is rejected and the second one loads.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
require("./lines.cjs");
track("first", import("./first.mjs"));
track("second", import("./second.mjs"));
