import { jest, mock, test, vi } from "bun:test";
mock.module("@made-up/fx", async () => ({ ...(await import("@made-up/fx")), rate: "patch" }));
test("a", async () => {
  console.log("a", (await import("./shop.mjs")).shown());
  jest.doMock("@made-up/fx", () => ({ ...jest.requireActual("@made-up/fx"), rate: "second patch" }));
});
