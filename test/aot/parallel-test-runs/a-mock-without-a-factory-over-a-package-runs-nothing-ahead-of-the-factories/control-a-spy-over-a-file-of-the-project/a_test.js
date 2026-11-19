import { test, vi, jest } from "bun:test";
test("x", async () => {
  vi.doMock("./part.mjs", { spy: true });
  const user = await import("./user.mjs");
  console.log("SAID spied", user.look(), globalThis.runs);
  const real = await vi.importActual("./part.mjs");
  console.log("SAID actual", typeof real.box.f.mock, typeof real.run.mock, real.run(), globalThis.runs);
});
