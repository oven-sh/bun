import { test, vi } from "bun:test";
import { price } from "../src/lib.ts";

test("a file that imports the package and resets", () => {
  console.log("a", price());
  vi.resetModules();
});
