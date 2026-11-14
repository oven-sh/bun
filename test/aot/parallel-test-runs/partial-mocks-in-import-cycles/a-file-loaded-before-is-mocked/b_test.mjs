import { jest, mock, test, vi } from "bun:test";
test("the importer reads the mock while it loads", async () => {
  vi.doMock("./price.mjs", async () => ({ ...(await import("./price.mjs")), price: () => "mock price" }));
  console.log((await import("./shop.mjs")).describe());
});
