import { test, vi } from "bun:test";
import * as barrel from "./barrel.mjs";

test("what two stars have is exported by none, also while a mock waits", async () => {
  vi.doMock("./counter.cjs", () => ({ count: 100, increment: () => 101 }));
  console.log("b", Object.keys(barrel).join(), "count" in barrel, barrel.count, barrel.counted);
  const again = await import("./barrel.mjs");
  console.log("b", Object.keys(again).join(), again.count, again.counted);
  console.log("b", Object.keys(barrel).join(), "count" in barrel, barrel.count, barrel.counted);
});
