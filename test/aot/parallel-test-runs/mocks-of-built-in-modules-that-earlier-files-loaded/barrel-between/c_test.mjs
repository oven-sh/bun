import { test, vi } from "bun:test";
import { top } from "./barrel.mjs";
test("c", async () => {
  console.log("SAID c", top());
});
