import { test, vi } from "vitest";
import { base } from "./base.mjs";
test("first file", () => {
  console.log("SAID a", base);
  vi.resetModules();
});
