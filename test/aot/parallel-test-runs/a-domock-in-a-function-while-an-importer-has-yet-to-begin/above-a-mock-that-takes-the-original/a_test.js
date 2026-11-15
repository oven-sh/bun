import { test, vi } from "bun:test";
import { viaTop } from "./top.js";
vi.mock("./mocked.js", async importOriginal => {
  const original = await importOriginal();
  return { ...original, tag: () => "mock of " + original.tag() };
});
test("t", async () => {
  console.log("SAID in the test", viaTop(), (await import("./dep.js")).who());
});
