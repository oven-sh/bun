import { jest, mock, test, vi } from "bun:test";
vi.doMock("@made-up/fx", async original => ({ ...(await original()), rate: "first" }));
await mock.module("@made-up/fx", async () => ({ ...(await import("@made-up/fx")), rate: "second" }));
test("b", async () => {
  const it = await vi.importActual("@made-up/tax");
  console.log("b", it.rate, it.under());
  console.log("b", (await import("@made-up/fx")).rate, (await import("./sale.mjs")).sold());
});
