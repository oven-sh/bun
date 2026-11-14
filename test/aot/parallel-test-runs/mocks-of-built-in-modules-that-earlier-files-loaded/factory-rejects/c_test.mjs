import { test, vi } from "bun:test";
import { top } from "./top.mjs";
test("c", async () => {
  console.log("SAID c", top());
});
