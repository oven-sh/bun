import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.doMock("@made-up/fx", { spy: true });
vi.doMock("@made-up/fx", async () => {
  await 0;
  return { rate: "mock" };
});
test("b", () => {
  console.log("b", sold());
});
