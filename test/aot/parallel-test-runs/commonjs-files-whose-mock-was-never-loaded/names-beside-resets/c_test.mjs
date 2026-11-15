import { test, vi } from "bun:test";
import { count } from "./counter.cjs";

test("the third file imports what it exports now", () => {
  console.log("c", count);
});

test("and resets its modules", () => {
  vi.resetModules();
  console.log("c", count, require("./counter.cjs").count);
});
