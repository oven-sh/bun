import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("@made-up/fx", async original => ({ ...(await original()), rate: "1R" }));
  console.log("SAID use", (await import("./user.mjs")).got());
  jest.doMock("@made-up/fx", () => ({ rate: "2R" }));
  console.log("SAID use", (await import("./user.mjs")).got());
  vi.doMock("@made-up/fx", async () => ({ ...(await vi.importActual("@made-up/fx")), rate: "3R" }));
});
