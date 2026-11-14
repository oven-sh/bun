import { jest, mock, test, vi } from "bun:test";
test("the importer reads the mock while it loads", async () => {
  await mock.module("./price.mjs", async () => ({ ...(await import("./price.mjs")), price: () => "mock price" }));
  console.log((await import("./cart.mjs")).atLoad, (await import("./shop.mjs")).describe());
});
