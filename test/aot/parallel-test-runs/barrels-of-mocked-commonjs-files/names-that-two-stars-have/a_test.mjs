import { test } from "bun:test";

test("an earlier file imports the counter", async () => {
  console.log("a", (await import("./counter.cjs")).increment());
});
