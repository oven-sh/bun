import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
  const three = await import("./three.mjs");
  console.log("SAID b", await three.seen());
});
