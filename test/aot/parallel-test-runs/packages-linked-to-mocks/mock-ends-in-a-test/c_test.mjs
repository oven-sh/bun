import { jest, mock, test, vi } from "bun:test";
await mock.module("@made-up/fx", async () => ({ ...(await import("@made-up/fx")), rate: "mock" }));
test("c0", async () => console.log("c0", (await import("@made-up/tax")).under()));
test("c1", async () => {
  jest.unmock("@made-up/fx");
  console.log("c1", (await import("@made-up/tax")).under());
});
