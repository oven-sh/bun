import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("./unit.js", () => ({ kept: "first" }));
  const own = (await import("./unit.js")).kept;
  const pack = await import("pack");
  console.log("SAID", own, pack.look());
  vi.doUnmock("./unit.js");
  const late = await import("./late.js");
  console.log("SAID between", late.look(), pack.look());
  mock.module("./unit.js", () => ({ kept: "second" }));
  console.log("SAID under", (await import("./unit.js")).kept, pack.look(), late.look());
  vi.doUnmock("./unit.js");
  console.log("SAID ended", pack.look(), late.look());
});
