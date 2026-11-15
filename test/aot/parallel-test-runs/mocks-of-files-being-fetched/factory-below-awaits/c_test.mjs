import { jest, mock, test, vi } from "bun:test";
const loading = import("./sale.mjs");
vi.doMock("./fx.mjs", async () => {
  await 0;
  return { rate: "second" };
});
test("c", async () => {
  console.log("c sale", (await loading).sold());
  console.log("c fx", (await import("./fx.mjs")).rate);
});
