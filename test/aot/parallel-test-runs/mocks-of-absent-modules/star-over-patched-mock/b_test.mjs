import { test, vi } from "bun:test";
vi.mock("./absent.mjs", () => ({ get: () => "mock of b", set() {} }));
test("b", async () => {
  const barrel = await import("./barrel.mjs");
  console.log("SAID b", Object.keys(barrel).sort().join(), barrel.get(), barrel.extra);
});
