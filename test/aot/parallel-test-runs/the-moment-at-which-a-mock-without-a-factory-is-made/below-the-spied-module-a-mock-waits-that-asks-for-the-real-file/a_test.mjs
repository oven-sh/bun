import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  mock.module("./b.mjs", async real => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { ...(await real()), x: 10 }; });
  vi.doMock("./a.mjs", { spy: true });
  await import("./a.mjs").then(a => console.log("SAID", a.y, "runs of a", globalThis.runsOfA, "factories", globalThis.calls), error => console.log("SAID threw", error.name));
  await import("./a.mjs").then(a => console.log("SAID", a.y, "runs of a", globalThis.runsOfA, "factories", globalThis.calls), error => console.log("SAID threw", error.name));
});
