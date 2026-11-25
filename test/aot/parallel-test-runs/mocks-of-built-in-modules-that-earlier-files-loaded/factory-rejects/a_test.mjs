import { test, vi } from "bun:test";
import { top } from "./top.mjs";
test("a", async () => {
  console.log("SAID a", top());
});
