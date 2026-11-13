import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("b", async () => {
  mock.module("@made-up/tax", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.cjs")).total());
  vi.doUnmock("@made-up/tax");
  console.log("unmocked", (await vi.importActual("./price.cjs")).total());
});
