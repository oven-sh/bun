// x.cjs runs while the graph of the root is loaded, and requires, under a name that the build does not know, an ES module that imports x.cjs. `bun run` has the
// graph of the root in its loader by then, and the load of that require() gives the loader x.cjs, which is all that the graph waits for: the graph runs, the root too,
// before the require() returns. The root throws: the require() returns all the same, and whoever started the root hears of it.
// Entry points: ./m.mjs
import { f } from "./m.mjs";
console.log("main runs", typeof f);
throw new Error("from main");
