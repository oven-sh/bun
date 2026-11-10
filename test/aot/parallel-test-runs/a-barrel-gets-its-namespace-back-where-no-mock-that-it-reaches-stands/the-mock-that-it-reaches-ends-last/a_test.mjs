import { test, vi } from "bun:test";
test("the namespace that the test holds", async () => {
  await import("./far.mjs");
  const held = await import("./barrel.mjs");
  vi.doMock("./near.mjs", () => ({ near: 10 }));
  console.log("near", (await import("./near.mjs")).near);
  vi.doMock("./far.mjs", () => ({ far: 20 }));
  console.log("far", (await import("./far.mjs")).far);
  vi.doUnmock("./far.mjs");
  vi.doUnmock("./near.mjs");
  console.log("the same", (await import("./barrel.mjs")) === held, Object.keys(held).sort().join());
});
