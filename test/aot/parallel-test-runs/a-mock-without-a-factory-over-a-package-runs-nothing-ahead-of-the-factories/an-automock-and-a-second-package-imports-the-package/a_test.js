import { test, vi, jest } from "bun:test";
test("x", async () => {
  vi.doMock("pack");
  const user = await import("./user.mjs");
  console.log("SAID spied", user.look(), globalThis.runs);
  const outer = await import("outer");
  console.log("SAID outer", outer.through(), globalThis.runs);
  const real = await vi.importActual("pack");
  console.log("SAID actual", typeof real.box.f.mock, typeof real.run.mock, real.run(), globalThis.runs);
});
