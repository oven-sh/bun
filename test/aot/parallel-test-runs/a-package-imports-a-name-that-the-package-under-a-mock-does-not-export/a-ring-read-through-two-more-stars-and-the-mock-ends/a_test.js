import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("loom/weft.mjs", () => ({ two: 20 }));
  console.log("held", (await import("loom/weft.mjs")).two);
  const { look } = await import("./whole.mjs");
  console.log("under", look());
  vi.doUnmock("loom/weft.mjs");
  console.log("behind", look());
});
