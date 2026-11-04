// A CommonJS file runs while the graph of its importer is loaded, and calls import() while texts of that graph are still to be read. `bun run` hears of each text in a turn of the event loop of its own,
// in the order in which they were asked for, and takes every step that a text allows in that turn: a module asks for what it imports when its own text has come. So what the call names comes ahead of
// what a module behind the file imports, and behind what a module ahead of the file imports.
// `bun run` reads on several threads, and the texts race: each stage prints these lines in 21 to 40 runs of 40 on an idle machine and in 11 to 30 of 30 on a busy one. The lines are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import stage from "./stage.cjs";

async function show(title, graph, calls = 1) {
  console.log("--", title);
  await graph();
  console.log("the graph is loaded");
  await stage.until(calls);
}

await show("two calls, two levels left", () => import("./two-root.mjs"), 2);
await show("one level is left, behind the file", () => import("./one-root.mjs"));
await show("one level is left, ahead of the file", () => import("./ahead-root.mjs"));
await show("what the call names has a level of its own", () => import("./deep-root.mjs"));
await show("a file below runs when its text comes", () => import("./file-root.mjs"));
await show("both import a module whose text is on its way", () => import("./shared-root.mjs"));
/* Output:
-- two calls, two levels left
asks
late
late is loaded
below later
later
later is loaded
third
second
first
root
the graph is loaded
-- one level is left, behind the file
asks
late
late is loaded
second
first
root
the graph is loaded
-- one level is left, ahead of the file
asks
below
reads
root
the graph is loaded
late
late is loaded
-- what the call names has a level of its own
asks
second
first
root
the graph is loaded
below late
late
late is loaded
-- a file below runs when its text comes
asks
late
late is loaded
file below
first
root
the graph is loaded
-- both import a module whose text is on its way
asks
both
first
root
late
the graph is loaded
late is loaded
*/
