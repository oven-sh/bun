import { test, vi } from "bun:test";
let reads = 0;
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10, get late() { reads++; return 5; } }));
  const user = await import("./user.mjs");
  const under = reads;
  vi.doUnmock("./part.cjs");
  console.log("SAID", user.look("kept"), "reads", under, reads);
});
