import { test, vi } from "bun:test";
test("two readers of one file", async () => {
  vi.doMock("node:path", () => ({ sep: "mock" }));
  const first = await import("./reader.mjs");
  console.log("SAID under", first.late());
  vi.doUnmock("node:path");
  await import("node:path");
  console.log("SAID behind a load", first.late());
  const second = await import("./later.mjs");
  console.log("SAID behind", first.late(), "|", second.late());
});
