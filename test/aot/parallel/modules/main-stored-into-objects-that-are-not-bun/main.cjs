// Alone: which file is the main module goes by the entry points of the executable
// `main` is an everyday name: the field of a package.json. A store under it counts as a store into Bun.main only where Bun is seen to arrive.
// STATISTIC: EngineRuns = 1
const other = require("./other.cjs");
const manifest = JSON.parse(process.env.MANIFEST || "{}");
manifest.main = "index.js";
globalThis.seenByTheHost?.(Bun);
const holder = globalThis.holderOfTheHost?.() ?? {};
holder.main = "index.js";
const copy = Object.assign({}, Bun, { main: "index.js" });
console.log(require.main === module, other.isMain(), require.main.filename === module.filename, manifest.main, holder.main, copy.main);
