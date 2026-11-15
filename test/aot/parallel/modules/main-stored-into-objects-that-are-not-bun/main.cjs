// Alone: which file is the main module goes by the entry points of the executable
// `main` is an everyday name: the field of a package.json. A store under it counts as a store into Bun.main only where Bun is seen to arrive.
// An earlier compiler ran the engine again where a first run showed that the load had missed or taken too much, and counted the runs: EngineRuns = 1. A build runs the engine once now.
const other = require("./other.cjs");
const manifest = JSON.parse(process.env.MANIFEST || "{}");
manifest.main = "index.js";
globalThis.seenByTheHost?.(Bun);
const holder = globalThis.holderOfTheHost?.() ?? {};
holder.main = "index.js";
const copy = Object.assign({}, Bun, { main: "index.js" });
console.log(require.main === module, other.isMain(), require.main.filename === module.filename, manifest.main, holder.main, copy.main);
