import { test, vi } from "bun:test";
const show = all => Object.keys(all).sort().map(key => key + "=" + String(Reflect.get(all, key))).join(",");
test("what the original shows, and the barrels above it", async () => {
  vi.doMock("./tools.cjs", () => ({ default: 1, kept: 10 }));
  vi.doMock("./mid.js", async original => {
    const taken = await original();
    console.log("SAID original", show(taken));
    return { ...taken, extra: 1 };
  });
  const user = await import("./user.js");
  console.log("SAID", user.look());
});
