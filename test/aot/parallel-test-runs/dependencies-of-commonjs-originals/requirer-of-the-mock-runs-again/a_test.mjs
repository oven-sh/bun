import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("a", async () => {
  console.log((await import("./shop.cjs")).sold());
  console.log("first", (jest.requireActual("./price.cjs")).total());
});
