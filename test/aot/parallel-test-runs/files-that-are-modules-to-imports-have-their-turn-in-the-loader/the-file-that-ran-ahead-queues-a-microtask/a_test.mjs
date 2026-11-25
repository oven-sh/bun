// real.cjs runs while the graph of top.mjs is loaded and queues a job, so the loader of the run time takes the graph over. plain.cjs is an ES module to that loader: it runs behind first.mjs.
import { test } from "bun:test";
test("the graph runs", async () => {
  await import("./top.mjs");
  console.log("the test ends");
});
