import { test, vi } from "bun:test";
const said = space => Object.keys(space).sort().map(key => key + "=" + String(Reflect.get(space, key))).join();
test("a", async () => {
  vi.doMock("loom/weft.mjs", () => ({ shape: "mocked", more: "mocked more" }));
  console.log("weft", said(await import("loom/weft.mjs")));
  console.log("warp", said(await import("loom/warp.mjs")));
});
