// The control: every name is there.
import { test } from "bun:test";
test("the graph runs", async () => {
  await import("./top.mjs");
  console.log("the test ends");
});
