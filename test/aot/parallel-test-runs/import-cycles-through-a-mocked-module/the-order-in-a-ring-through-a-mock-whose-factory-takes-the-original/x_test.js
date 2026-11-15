import { expect, test, vi } from "bun:test";
vi.mock("./m0.js", async importOriginal => {
  const original = await importOriginal();
  globalThis.order.push("factory");
  return { ...original, name: "mock" };
});
import "./m1.js";
test("the original first, the factory, then the module that imports the mock", () => expect(globalThis.order).toEqual(["m0", "factory", "m1"]));
