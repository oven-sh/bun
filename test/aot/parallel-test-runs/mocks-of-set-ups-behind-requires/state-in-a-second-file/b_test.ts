import { jest, test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./goods.ts", () => ({ name: () => "one", sell: () => 100 }));
  console.log("one", require("./cart.cjs").sell());
});
test("two", () => {
  vi.doMock("./goods.ts", () => ({ ...jest.requireActual<any>("./goods.ts"), name: () => "two" }));
  console.log("two", require("./cart.cjs").sell());
});
