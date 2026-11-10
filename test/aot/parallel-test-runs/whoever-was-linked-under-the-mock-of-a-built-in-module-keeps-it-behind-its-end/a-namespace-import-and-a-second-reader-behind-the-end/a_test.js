import { test, vi } from "bun:test";
test("under the mock, behind its end and behind a load", async () => {
  let other;
  vi.doMock("node:path", () => ({ sep: "mock", made: 20 }));
  const under = await import("./reader.mjs");
  console.log("SAID under", under.late(), "|", other ? other.late() : "not yet");
  vi.doUnmock("node:path");
  console.log("SAID at once", under.late(), "|", other ? other.late() : "not yet");
  other = await import("./later.mjs");
  console.log("SAID behind a load", under.late(), "|", other ? other.late() : "not yet");
});
