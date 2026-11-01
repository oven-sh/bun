// x.cjs runs while the graph of the root is loaded, and requires, under a name that the build does not know, an ES module that imports x.cjs. `bun run` has the
// graph of the root in its loader by then, and the load of that require() gives the loader x.cjs, which is all that the graph waits for: the graph runs, the root too,
// before the require() returns. It is the root itself that is required.
import { f } from "./m.mjs";
export const h = 1;
console.log("main runs", typeof f);
