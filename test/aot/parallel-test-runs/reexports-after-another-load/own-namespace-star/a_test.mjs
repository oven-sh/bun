import { test, vi } from "bun:test";
import { leaf } from "./leaf.mjs";
export * as self from "./a_test.mjs";
export let value = (globalThis.runs = (globalThis.runs ?? 0) + leaf) * 100;
test.skip("mocks", () => { vi.doMock("./leaf.mjs", () => ({ leaf: 2 })); });
test("a", async () => {
  globalThis.first ??= await import("./a_test.mjs");
  if (globalThis.runs < 2) return;
  console.log("SAID", globalThis.first.value, globalThis.first.self.value, globalThis.first.self === globalThis.first);
  console.log("SAID END");
});
