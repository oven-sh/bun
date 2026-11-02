// The file that throws has itself called the import() that leads to the next importer of shared.mjs. `bun run` hears of the text of between.cjs in a later turn of the event loop, when the graph of first.mjs has failed.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import("./first.mjs").then(() => console.log("first loaded"), error => console.log("first rejected:", error.message));
