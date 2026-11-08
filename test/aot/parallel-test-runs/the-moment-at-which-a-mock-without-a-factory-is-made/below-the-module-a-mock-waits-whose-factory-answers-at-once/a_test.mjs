import { test, mock, vi, jest } from "bun:test";
test("t", async () => {
  vi.doMock("./b.mjs", () => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { x: 10 }; });
  vi.doMock("./a.mjs");
  await import("./a.mjs").then(a => console.log("SAID", a.y, "runs of a", globalThis.runsOfA, "factories", globalThis.calls), error => console.log("SAID threw", error.name));
  await import("./a.mjs").then(a => console.log("SAID", a.y, "runs of a", globalThis.runsOfA, "factories", globalThis.calls), error => console.log("SAID threw", error.name));
});
