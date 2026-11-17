import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./price.mjs", () => ({ total: () => "mock" }));
  console.log((await import("./shop.mjs")).sold());
  console.log("first", (jest.requireActual("./price.mjs")).total());
});
