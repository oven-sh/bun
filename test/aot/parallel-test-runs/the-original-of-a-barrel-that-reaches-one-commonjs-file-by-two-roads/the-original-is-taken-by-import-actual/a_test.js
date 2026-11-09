import { test, vi } from "bun:test";
const show = all => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(",");
test("what the original shows, and the barrel above the mock", async () => {
  vi.doMock("./mid.js", async () => {
    const taken = await vi.importActual("./mid.js");
    console.log("SAID original", show(taken));
    return { ...taken, extra: 1 };
  });
  console.log("SAID", (await import("./user.js")).look());
});
