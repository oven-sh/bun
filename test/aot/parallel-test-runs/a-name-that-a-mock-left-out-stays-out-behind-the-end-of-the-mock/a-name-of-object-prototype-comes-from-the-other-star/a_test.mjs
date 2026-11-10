import { test, vi } from "bun:test";
class Made { helper() {} }
test("t", async () => {
  vi.doMock("./part.cjs", () => Object.assign(new Made(), { kept: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID under the mock", user.look("kept", "valueOf", "helper"));
  vi.doUnmock("./part.cjs");
  console.log("SAID behind its end", user.look("kept", "valueOf", "helper"));
});
