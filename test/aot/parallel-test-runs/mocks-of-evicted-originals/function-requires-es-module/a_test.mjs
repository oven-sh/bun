import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./price.cjs", () => ({ total: () => "mock" }));
  console.log("first", (await vi.importActual("./price.cjs")).total());
});
