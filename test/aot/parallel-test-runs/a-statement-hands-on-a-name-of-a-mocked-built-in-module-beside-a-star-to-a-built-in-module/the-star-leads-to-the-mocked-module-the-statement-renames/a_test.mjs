import { test, vi } from "bun:test";
test("under the mock and behind a load behind its end", async () => {
  vi.doMock("node:path", () => ({ sep: "mock" }));
  const under = await import("./reader.mjs");
  console.log("SAID under", under.late());
  vi.doUnmock("node:path");
  await import("node:path");
  console.log("SAID behind a load", under.late());
});
