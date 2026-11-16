import { test, vi, mock } from "bun:test";
test("old reader", async () => {
  vi.doMock("pack/shapes.mjs", () => ({ round: 100 }));
  console.log("SAID", (await import("pack/shapes.mjs")).round);
  const { look } = await import("./whole.mjs");
  console.log("SAID under", look());
  vi.doUnmock("pack/shapes.mjs");
  console.log("SAID behind", look());
  vi.doMock("pack/shapes.mjs", () => ({ round: 200, flat: 300 }));
  console.log("SAID under the second", look());
  console.log("SAID fresh", (await import("./fresh.mjs")).look());
});
