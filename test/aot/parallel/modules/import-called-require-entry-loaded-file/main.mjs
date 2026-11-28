// Alone: the order depends on which file the executable was started as: where an import() loads main.mjs, it runs before on-demand.cjs, in `bun run` too.
import "./importer.mjs";
console.log("main runs");
