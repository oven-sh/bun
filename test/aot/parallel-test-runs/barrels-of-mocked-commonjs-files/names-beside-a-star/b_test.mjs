import { test, vi } from "bun:test";
import * as counter from "./counter.cjs";
import * as barrel from "./barrel.mjs";

test("what the barrel hands on stays while a mock waits", async () => {
  console.log("b", counter.count, Object.keys(barrel).join());
  vi.doMock("./counter.cjs", () => ({ count: 100, increment: () => 101 }));
  console.log("b", barrel.count, typeof barrel.add, barrel.list.join(), barrel.own, "count" in barrel, Object.keys(barrel).join());
  const { count, add, ...rest } = barrel;
  console.log("b", count, add(), JSON.stringify(rest));
  const again = await import("./barrel.mjs");
  console.log("b", again.count, barrel.count, again === barrel);
});
