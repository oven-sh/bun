import { test, vi } from "bun:test";
vi.mock("./leaf.mjs", () => ({ leaf: "mock", other: 2 }));
test("b", async () => {
  const barrel = await import("./barrel.mjs");
  console.log("SAID b", Object.keys(barrel).join(), barrel.leaf, barrel.extra);
});
