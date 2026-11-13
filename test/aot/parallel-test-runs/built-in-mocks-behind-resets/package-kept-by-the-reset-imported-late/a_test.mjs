import { test, vi } from "bun:test";
import { user } from "./user.mjs";
test("a", () => {
  console.log("a", user());
  vi.resetModules();
});
