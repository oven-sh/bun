import { test, vi } from "bun:test";
test("x", async () => {
  vi.doMock("./pad.cjs", () => ({ spare: 1, y: 30 }));
  vi.doMock("./c.cjs", () => ({ y: 10 }));
  const under = await import("./n.mjs");
  console.log("SAID under", under.late());
  vi.doUnmock("./c.cjs");
  vi.doUnmock("./pad.cjs");
  console.log("SAID at once", under.late());
  const next = await import("./c.cjs");
  console.log("SAID behind a load", under.late(), "|", Object.keys(next).filter(name => name !== "default").join(), next.y, next.z);
  console.log("SAID once more", under.late());
});
