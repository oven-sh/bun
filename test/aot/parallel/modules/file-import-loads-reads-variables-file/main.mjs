// top.mjs imports waiting.mjs, which imports drains.mjs. The call in drains.mjs runs the waiting jobs, and one of them evaluates reader.mjs, which imports waiting.mjs too:
// the code of waiting.mjs has not begun, so each of its variables is as the language leaves it before that.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import("./top.mjs").then(() => console.log("top loaded"));
import("./reader.mjs").then(() => console.log("reader loaded"));
console.log("main ends");
