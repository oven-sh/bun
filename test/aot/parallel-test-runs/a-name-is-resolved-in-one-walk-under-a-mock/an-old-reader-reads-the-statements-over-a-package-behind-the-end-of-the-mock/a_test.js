import { test, vi } from "bun:test";
test("names", async () => {
  vi.doMock("pack/shapes.mjs", () => ({ a0: 100 }));
  const { look } = await import("./whole.mjs");
  console.log("SAID", look());
  console.log("SAID", (await import("pack/shapes.mjs")).a0);
  vi.doUnmock("pack/shapes.mjs");
  for (let i = 0; i < 4; i++) {
    Bun.gc(true);
    const kept = [];
    for (let k = 0; k < 20000; k++) kept.push({ k, t: "x" + k });
  }
  console.log("SAID", look());
});
