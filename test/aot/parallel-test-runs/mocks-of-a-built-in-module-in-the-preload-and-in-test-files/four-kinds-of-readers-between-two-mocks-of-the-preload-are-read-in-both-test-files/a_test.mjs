import { test, mock, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a in front", [String(globalThis.pass.sep), globalThis.space.late(), globalThis.named.late(), globalThis.direct.late()].join(" | "));
  vi.doMock("node:path", () => ({ sep: "of a" }));
  await import("node:path");
  console.log("SAID a under", [String(globalThis.pass.sep), globalThis.space.late(), globalThis.named.late(), globalThis.direct.late()].join(" | "));
});
