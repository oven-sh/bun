import { test, vi } from "bun:test";
import * as counter from "./counter.cjs";

test("the third file imports what it exports now", async () => {
  console.log("c", counter.count, counter.last, Object.keys(counter).join());
  console.log("c", (await import("./counter.cjs")).last);
});

test("a file that spells a reset", () => {
  if (process.env.NEVER_SET)
    vi.resetModules();
});
