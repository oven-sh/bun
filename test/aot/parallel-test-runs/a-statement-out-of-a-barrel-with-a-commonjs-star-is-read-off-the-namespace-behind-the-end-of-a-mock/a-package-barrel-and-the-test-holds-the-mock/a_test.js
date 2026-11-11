import { test, vi, mock } from "bun:test";
test("old reader", async () => {
  vi.doMock("pack/shapes.mjs", () => ({ round: 100 }));
  console.log("SAID", (await import("pack/shapes.mjs")).round);
  const { look } = await import("./whole.mjs");
  console.log("SAID under", look());
  vi.doUnmock("pack/shapes.mjs");
  console.log("SAID behind", look());
});
