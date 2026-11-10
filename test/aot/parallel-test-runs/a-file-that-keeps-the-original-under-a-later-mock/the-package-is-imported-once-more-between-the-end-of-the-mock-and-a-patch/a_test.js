import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("./unit.js", () => ({ kept: "first" }));
  const own = (await import("./unit.js")).kept;
  const pack = await import("pack");
  console.log("SAID", own, pack.look());
  vi.doUnmock("./unit.js");
  const again = await import("pack");
  console.log("SAID between", again.look(), again === pack);
  mock.module("./unit.js", () => ({ kept: "second" }));
  console.log("SAID under", (await import("./unit.js")).kept, pack.look());
  vi.doUnmock("./unit.js");
  console.log("SAID ended", pack.look());
});
