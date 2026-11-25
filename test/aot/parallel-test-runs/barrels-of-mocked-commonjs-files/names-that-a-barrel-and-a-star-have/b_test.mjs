import { test, vi } from "bun:test";
import * as all from "./index.mjs";

test("what two stars have is exported by none, also while a mock waits", async () => {
  vi.doMock("./counter.cjs", () => ({ count: 100, increment: () => 101 }));
  console.log("b", Object.keys(all).join(), "count" in all, all.count, all.held);
  console.log("b", (await import("./counter.cjs")).count);
  console.log("b", Object.keys(all).join(), "count" in all, all.count, all.held);
});
