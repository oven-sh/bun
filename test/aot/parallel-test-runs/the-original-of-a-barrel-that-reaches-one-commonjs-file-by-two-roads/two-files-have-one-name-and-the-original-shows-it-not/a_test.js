import { test, vi } from "bun:test";
const show = all => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(",");
test("what the original shows, and the barrel above the mock", async () => {
  vi.doMock("./mid.js", async original => {
    const taken = await original();
    console.log("SAID original", show(taken));
    return { ...taken, extra: 1 };
  });
  await import("./mid.js");
});
