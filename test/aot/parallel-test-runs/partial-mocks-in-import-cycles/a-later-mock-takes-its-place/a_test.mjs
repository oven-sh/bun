import { jest, mock, test, vi } from "bun:test";
test("the importer reads each mock while it loads", async () => {
  vi.doMock("./price.mjs", async () => ({ ...(await import("./price.mjs")), price: () => "mock price" }));
  console.log((await import("./shop.mjs")).describe());
  vi.doMock("./price.mjs", () => ({ price: () => "second price", labeled: () => "second label" }));
  console.log((await import("./shop.mjs")).describe());
  vi.doUnmock("./price.mjs");
  console.log((await import("./shop.mjs")).describe());
});
