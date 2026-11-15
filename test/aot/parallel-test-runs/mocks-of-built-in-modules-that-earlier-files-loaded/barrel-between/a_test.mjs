import { test, vi } from "bun:test";
import { top } from "./barrel.mjs";
test("a", async () => {
  console.log("SAID a", top());
});
