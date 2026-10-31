// asks.cjs runs while the graph of this module is loaded, and calls import(). `bun run` reads the text of late.cjs on another thread and hears of it in a later turn of the
// event loop: this module runs first, and so does every job and every tick that waits.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import { name } from "./asks.cjs";
console.log("main", name, "after", jobsRun(), "jobs");
queueMicrotask(() => console.log("job of main"));
process.nextTick(() => console.log("tick of main"));
