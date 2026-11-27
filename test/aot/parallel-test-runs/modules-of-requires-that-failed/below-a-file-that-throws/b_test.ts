import { test, vi } from "bun:test";
import { order } from "./order";

test("the next file mocks what it imports", () => {
  console.log("b", order());
  vi.doMock("./price", () => ({ price: () => "mocked" }));
  console.log("b", order());
});
