import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID use", (await import("./user.mjs")).got());
  vi.doMock("@made-up/fx", async original => ({ ...(await original()), rate: "1R" }));
  console.log("SAID use", (await import("./user.mjs")).got());
  mock.module("@made-up/fx", () => ({ ...jest.requireActual("@made-up/fx"), rate: "2R" }));
  console.log("SAID use", (await import("./user.mjs")).got());
  vi.doMock("@made-up/fx", async () => ({ ...(await vi.importActual("@made-up/fx")), rate: "3R" }));
});
