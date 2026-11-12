import { test, vi } from "bun:test";
test("under the mock, behind its end and behind a load", async () => {
  vi.doMock("node:path", () => ({ sep: "mock", made: 20 }));
  const under = await import("./reader.mjs");
  console.log("SAID under", under.late());
  vi.doUnmock("node:path");
  console.log("SAID at once", under.late());
  await import("node:path");
  console.log("SAID behind a load", under.late());
});
