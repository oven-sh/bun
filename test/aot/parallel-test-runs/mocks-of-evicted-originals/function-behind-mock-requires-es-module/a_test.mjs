import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./price.cjs", async () => {
    const price = await vi.importActual("./price.cjs");
    return { total: () => "mock of " + price.total() };
  });
  console.log("first", (await import("./price.cjs")).total());
});
