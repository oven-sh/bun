import { test, vi } from "bun:test";
test("a late file imports the name through the ring", async () => {
  await import("./b1.mjs");
  vi.doMock("./store.cjs", () => ({ count: 10 }));
  console.log("SAID", await import("./late.mjs").then(it => it.read(), error => error.name));
});
