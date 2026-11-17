import { test, vi } from "bun:test";

test("x", async () => {
  vi.doMock("./c.cjs", () => ({ y: 10, z: 20 }));
  const under = await import("./n.mjs");
  console.log("SAID under", under.late());
  vi.doUnmock("./c.cjs");
  console.log("SAID at once", under.late());
  const next = await import("./c.cjs");
  console.log("SAID behind a load", under.late(), next.y, next.z);
});
