import { test, jest, mock, vi } from "bun:test";
const order = [];
test("who calls the factory", async () => {
  await import("./shelf.mjs").catch(() => {});
  require("./tools.cjs");
  mock.module("./tools.cjs", () => ({ name: 5 }));
  vi.doUnmock("./tools.cjs");
  jest.doMock("./shelf.mjs", real => { order.push("factory"); return { before: 7 }; });
  order.push("behind the call");
  console.log(order.join(" > "));
});
