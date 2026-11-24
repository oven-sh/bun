import { test, vi } from "bun:test";
test("two readers of one file", async () => {
  vi.doMock("./part.mjs", () => ({ sep: "mock" }));
  const first = await import("./reader.mjs");
  console.log("SAID under", first.late());
  vi.doUnmock("./part.mjs");
  const second = await import("./later.mjs");
  console.log("SAID behind", first.late(), "|", second.late());
});
