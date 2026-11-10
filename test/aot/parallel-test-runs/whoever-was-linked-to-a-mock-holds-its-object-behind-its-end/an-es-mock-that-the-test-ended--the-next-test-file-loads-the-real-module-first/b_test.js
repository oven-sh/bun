import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
  console.log("SAID the real one", (await import("./dep.mjs")).value());
  const keep = await import("./keep.mjs");
  console.log("SAID b", keep.show());
});
