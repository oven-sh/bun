// plain.cjs and real.cjs run in the order of the imports, and the job that real.cjs queues runs behind top.mjs.
import { test } from "bun:test";
test("the graph runs", async () => {
  await import("./top.mjs");
  console.log("the test ends");
});
