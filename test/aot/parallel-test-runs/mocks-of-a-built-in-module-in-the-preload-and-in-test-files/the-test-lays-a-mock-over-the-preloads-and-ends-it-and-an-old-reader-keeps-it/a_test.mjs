import { test, mock, vi } from "bun:test";
test("a mock of the test file over the preload's", async () => {
  const old = await import("./old.mjs");
  console.log("SAID at first", old.late());
  vi.doMock("node:path", () => ({ sep: "second" }));
  const young = await import("./young.mjs");
  console.log("SAID under", young.late(), old.late());
  vi.doUnmock("node:path");
  await import("node:path");
  console.log("SAID ended", young.late(), old.late());
});
