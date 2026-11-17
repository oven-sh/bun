import { jest, mock, test, vi } from "bun:test";
test("c", async () => {
  console.log("c", (await import("@made-up/fx")).count());
  vi.doMock("@made-up/fx", async importOriginal => ({ ...(await importOriginal()), rate: "mock" }));
  console.log("under", (await import("@made-up/fx")).count());
});
