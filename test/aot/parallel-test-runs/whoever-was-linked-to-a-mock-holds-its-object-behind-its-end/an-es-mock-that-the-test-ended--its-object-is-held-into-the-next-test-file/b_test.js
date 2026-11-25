import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
  const keep = await import("./keep.mjs");
  console.log("SAID b", keep.show());
});
