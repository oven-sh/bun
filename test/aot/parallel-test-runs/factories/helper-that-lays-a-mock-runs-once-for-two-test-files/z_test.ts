// It does not import helper.ts: no load of it comes to the module that mocked, and nothing is laid again.
import { test } from "bun:test";

test("z", async () => {
  console.log("z", (await import("./rate")).rate);
});
